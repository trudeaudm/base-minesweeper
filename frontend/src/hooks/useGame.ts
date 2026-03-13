import { useState, useEffect, useCallback, useRef } from "react";
import {
  useReadContract,
  useWriteContract,
  useWatchContractEvent,
  useAccount,
  usePublicClient,
} from "wagmi";
import { parseEventLogs } from "viem";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import {
  CONTRACT_ADDRESS,
  SUPPORTED_CHAIN,
  RPC_URL,
  RELAYER_URL,
  GameStatus,
  GRID_INFO,
  calcMultiplier,
} from "@/lib/config";
import {
  getOrCreateSessionKey,
  clearSessionKey,
  createSessionWalletClient,
} from "@/lib/session";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TileState =
  | "unrevealed"
  | "safe"
  | "mine"
  | "pending"; // flip in-flight

export interface GameState {
  gameId:         bigint | null;
  status:         GameStatus;
  gridSize:       number;
  difficulty:     number;
  entryFee:       bigint;
  maxPayout:      bigint;
  mineBitmask:    bigint;
  revealedBitmask:bigint;
  safeRevealed:   number;
  totalSafe:      number;
  tileStates:     TileState[];
  multiplier:     number;
  currentPayout:  bigint;
  sessionKeyAddr: `0x${string}` | null;
  isWaitingVRF:   boolean;
  isActive:       boolean;
  isCashedOut:    boolean;
  isGameOver:     boolean;
}

const EMPTY_STATE: GameState = {
  gameId:          null,
  status:          GameStatus.WAITING_VRF,
  gridSize:        0,
  difficulty:      1,
  entryFee:        0n,
  maxPayout:       0n,
  mineBitmask:     0n,
  revealedBitmask: 0n,
  safeRevealed:    0,
  totalSafe:       0,
  tileStates:      [],
  multiplier:      0,
  currentPayout:   0n,
  sessionKeyAddr:  null,
  isWaitingVRF:    false,
  isActive:        false,
  isCashedOut:     false,
  isGameOver:      false,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildTileStates(
  totalTiles:      number,
  revealedBitmask: bigint,
  mineBitmask:     bigint,
): TileState[] {
  return Array.from({ length: totalTiles }, (_, i) => {
    const revealed = ((revealedBitmask >> BigInt(i)) & 1n) === 1n;
    if (!revealed) return "unrevealed";
    const isMine = ((mineBitmask >> BigInt(i)) & 1n) === 1n;
    return isMine ? "mine" : "safe";
  });
}

/**
 * Ask the relayer to fund the session key for this game.
 * Fire-and-forget: the session key will have gas long before VRF resolves.
 */
async function requestRelayerFunding(
  gameId: bigint,
  sessionKeyAddress: `0x${string}`,
): Promise<void> {
  if (!RELAYER_URL) return;
  try {
    const res = await fetch(`${RELAYER_URL}/fund`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        gameId:            gameId.toString(),
        sessionKeyAddress,
      }),
    });
    if (!res.ok) {
      console.warn("[relayer] fund failed:", await res.text());
    }
  } catch (err) {
    // Non-fatal: worst case the player gets a wallet popup for flips
    console.warn("[relayer] fund request error:", err);
  }
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useGame() {
  const { address: playerAddress } = useAccount();
  const publicClient = usePublicClient();

  const [gameState, setGameState]   = useState<GameState>(EMPTY_STATE);
  const [pendingTile, setPendingTile] = useState<number | null>(null);
  const [isStarting, setIsStarting]   = useState(false);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const sessionAcc = useRef(getOrCreateSessionKey());

  // ── Read active game for player ──────────────────────────────────────────
  const { data: activeGameId, refetch: refetchActiveGame } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "playerActiveGame",
    args:    [playerAddress ?? "0x0000000000000000000000000000000000000000"],
    query:   {
      enabled:        !!playerAddress,
      refetchInterval: 5_000,
    },
  });

  const currentGameId = gameState.gameId ?? activeGameId ?? null;

  // ── Read full game state ─────────────────────────────────────────────────
  const { data: rawGame, refetch: refetchGame } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "getGame",
    args:    [currentGameId ?? 0n],
    query:   {
      enabled:        !!currentGameId && currentGameId > 0n,
      refetchInterval: 3_000,
    },
  });

  // ── Sync rawGame → gameState ─────────────────────────────────────────────
  useEffect(() => {
    if (!rawGame || !currentGameId) return;

    const [
      , sessionKey, gridSize, difficulty, entryFee,
      maxPayout, mineBitmask, revealedBitmask,
      safeRevealed, totalSafe, statusNum, ,
    ] = rawGame;

    const status     = statusNum as GameStatus;
    const totalTiles = GRID_INFO[gridSize as 0|1|2].totalTiles;
    const isHard     = difficulty === 2;
    const mult       = calcMultiplier(safeRevealed, totalSafe, isHard);
    const payout     = safeRevealed === 0
      ? 0n
      : (maxPayout * BigInt(safeRevealed)) / BigInt(totalSafe);

    const tiles = buildTileStates(totalTiles, revealedBitmask, mineBitmask);
    if (pendingTile !== null && tiles[pendingTile] === "unrevealed") {
      tiles[pendingTile] = "pending";
    }

    setGameState({
      gameId:          currentGameId,
      status,
      gridSize,
      difficulty,
      entryFee,
      maxPayout,
      mineBitmask,
      revealedBitmask,
      safeRevealed,
      totalSafe,
      tileStates:     tiles,
      multiplier:     mult,
      currentPayout:  payout,
      sessionKeyAddr: sessionKey !== "0x0000000000000000000000000000000000000000"
        ? sessionKey as `0x${string}`
        : null,
      isWaitingVRF: status === GameStatus.WAITING_VRF,
      isActive:     status === GameStatus.ACTIVE,
      isCashedOut:  status === GameStatus.CASHED_OUT,
      isGameOver:   status === GameStatus.GAME_OVER,
    });
  }, [rawGame, currentGameId, pendingTile]);

  // ── Wallet write hook (used only for startGame) ──────────────────────────
  const { writeContractAsync } = useWriteContract();

  // ─────────────────────────────────────────────────────────────────────────
  // Start Game  (1 wallet popup – pays entry fee & registers session key)
  // ─────────────────────────────────────────────────────────────────────────
  const startGame = useCallback(async (
    gridSize:   number,
    difficulty: number,
  ) => {
    if (!playerAddress) throw new Error("Wallet not connected");
    setError(null);
    setIsStarting(true);

    try {
      // Fresh session key each game
      clearSessionKey();
      sessionAcc.current = getOrCreateSessionKey();
      const sk = sessionAcc.current.address;

      const entryFee = GRID_INFO[gridSize as 0|1|2].entryFee;

      // Single wallet signature: pays entry fee, registers session key on-chain
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESS,
        abi:          MINESWEEPER_ABI,
        functionName: "startGame",
        args:         [gridSize, difficulty, sk],
        value:        entryFee,
      });

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const logs = parseEventLogs({ abi: MINESWEEPER_ABI, logs: receipt.logs });
        const started = logs.find(l => l.eventName === "GameStarted");
        if (started) {
          const gameId = (started.args as { gameId: bigint }).gameId;
          setGameState(prev => ({
            ...prev,
            gameId,
            status:      GameStatus.WAITING_VRF,
            isWaitingVRF: true,
          }));
          refetchGame();
          refetchActiveGame();

          // Ask relayer to fund the session key with gas money.
          // Happens in background while VRF resolves (~30-60 s), so by the
          // time the player can flip any tile the session key has ETH.
          requestRelayerFunding(gameId, sk);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start game");
    } finally {
      setIsStarting(false);
    }
  }, [playerAddress, writeContractAsync, publicClient, refetchGame, refetchActiveGame]);

  // ─────────────────────────────────────────────────────────────────────────
  // Flip Tile  (signed by session key – zero wallet popups)
  // Falls back to connected wallet if no relayer is configured.
  // ─────────────────────────────────────────────────────────────────────────
  const flipTile = useCallback(async (tileIndex: number) => {
    if (!gameState.gameId || !gameState.isActive) return;
    if (gameState.tileStates[tileIndex] !== "unrevealed") return;

    setError(null);
    setPendingTile(tileIndex);

    try {
      const sessionClient = createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL);

      if (sessionClient) {
        // Gasless path: session key submits the tx directly
        const hash = await sessionClient.writeContract({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "flipTile",
          args:         [gameState.gameId, tileIndex],
        });
        // Wait for inclusion so refetch returns fresh state
        await publicClient?.waitForTransactionReceipt({ hash });
      } else {
        // Fallback: wallet signs (relayer not configured or key missing)
        await writeContractAsync({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "flipTile",
          args:         [gameState.gameId, tileIndex],
        });
      }

      await refetchGame();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to flip tile");
    } finally {
      setPendingTile(null);
    }
  }, [gameState, writeContractAsync, publicClient, refetchGame]);

  // ─────────────────────────────────────────────────────────────────────────
  // Cash Out  (signed by session key – zero wallet popups)
  // Falls back to connected wallet if session key is unavailable.
  // ─────────────────────────────────────────────────────────────────────────
  const cashOut = useCallback(async () => {
    if (!gameState.gameId || !gameState.isActive) return;
    if (gameState.safeRevealed === 0) return;

    setError(null);
    setIsCashingOut(true);

    try {
      const sessionClient = createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL);

      if (sessionClient) {
        const hash = await sessionClient.writeContract({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "cashOut",
          args:         [gameState.gameId],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
      } else {
        await writeContractAsync({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "cashOut",
          args:         [gameState.gameId],
        });
      }

      await refetchGame();
      await refetchActiveGame();
      clearSessionKey();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to cash out");
    } finally {
      setIsCashingOut(false);
    }
  }, [gameState, writeContractAsync, publicClient, refetchGame, refetchActiveGame]);

  // ── Watch TileRevealed events ────────────────────────────────────────────
  useWatchContractEvent({
    address:   CONTRACT_ADDRESS,
    abi:       MINESWEEPER_ABI,
    eventName: "TileRevealed",
    onLogs: (logs) => {
      const relevant = logs.filter(l => l.args.gameId === gameState.gameId);
      if (relevant.length > 0) refetchGame();
    },
  });

  // ── Watch GameCashedOut / GameOver ───────────────────────────────────────
  useWatchContractEvent({
    address:   CONTRACT_ADDRESS,
    abi:       MINESWEEPER_ABI,
    eventName: "GameCashedOut",
    onLogs: () => { refetchGame(); refetchActiveGame(); },
  });

  useWatchContractEvent({
    address:   CONTRACT_ADDRESS,
    abi:       MINESWEEPER_ABI,
    eventName: "GameOver",
    onLogs: () => { refetchGame(); refetchActiveGame(); },
  });

  // ── Reset (start over after win/loss) ────────────────────────────────────
  const resetGame = useCallback(() => {
    setGameState(EMPTY_STATE);
    setError(null);
    clearSessionKey();
    refetchActiveGame();
  }, [refetchActiveGame]);

  return {
    gameState,
    isStarting,
    isCashingOut,
    pendingTile,
    error,
    sessionKeyAddr: sessionAcc.current.address,
    startGame,
    flipTile,
    cashOut,
    resetGame,
    refetchGame,
  };
}
