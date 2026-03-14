import { useState, useEffect, useCallback, useRef } from "react";
import {
  useReadContract,
  useWriteContract,
  useWatchContractEvent,
  useAccount,
  usePublicClient,
  useBlockNumber,
} from "wagmi";
import { parseEventLogs } from "viem";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import {
  CONTRACT_ADDRESS,
  SUPPORTED_CHAIN,
  RPC_URL,
  SESSION_GAS_BUDGET,
  GameStatus,
  GRID_INFO,
  calcMultiplier,
  CANCEL_BLOCKS_WAITING_FIRST_FLIP,
} from "@/lib/config";
import {
  getOrCreateSessionKey,
  getSessionKey,
  clearSessionKey,
  createSessionWalletClient,
} from "@/lib/session";
import type { PublicClient } from "viem";

// Explicit gas limits for session-key txs (avoid "gas required exceeds allowance (0)" when estimation fails)
const GAS_LIMIT_FIRST_FLIP = 600_000n;  // firstFlip requests VRF + state updates
const GAS_LIMIT_FLIP_TILES = 400_000n;
const GAS_LIMIT_CASH_OUT  = 200_000n;

/** Min session-key balance to use it; otherwise fall back to connected wallet (avoids "allowance (0)" when key has no ETH). */
const SESSION_KEY_MIN_BALANCE = 50_000_000_000_000n; // 0.00005 ETH

/** True if we have a session key with enough balance to pay for gas (so we can use it instead of wallet popup). */
async function canUseSessionKey(publicClient: PublicClient | null | undefined): Promise<boolean> {
  const account = getSessionKey();
  if (!account || !publicClient) return false;
  const balance = await publicClient.getBalance({ address: account.address });
  return balance >= SESSION_KEY_MIN_BALANCE;
}

/** Returns a short user-facing message for wallet rejections; otherwise the original message. */
function normalizeWalletError(e: unknown, action?: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null;
  const shortMsg =
    e && typeof e === "object" && "shortMessage" in e
      ? (e as { shortMessage: string }).shortMessage
      : "";
  const isRejection =
    code === 4001 ||
    /rejected the request|user rejected|user denied|denied transaction/i.test(msg) ||
    /rejected the request|user rejected|user denied/i.test(shortMsg);
  if (isRejection)
    return action ? `You declined to ${action}.` : "You declined the transaction.";
  return msg || "Something went wrong.";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TileState =
  | "unrevealed"
  | "safe"
  | "mine"
  | "pending"; // flip in-flight

export interface GameState {
  gameId:              bigint | null;
  status:              GameStatus;
  gridSize:            number;
  difficulty:          number;
  entryFee:            bigint;
  maxPayout:           bigint;
  mineBitmask:         bigint;
  revealedBitmask:     bigint;
  safeRevealed:        number;
  totalSafe:           number;
  tileStates:          TileState[];
  multiplier:          number;
  currentPayout:       bigint;
  sessionKeyAddr:      `0x${string}` | null;
  startBlock:          bigint; // block number when startGame() was called
  startedAt:           bigint; // Unix timestamp (seconds) when game was created
  isWaitingFirstFlip:  boolean; // board shown, waiting for player's first click
  isWaitingVRF:        boolean; // first click made, VRF in-flight
  isActive:            boolean;
  isCashedOut:         boolean;
  isGameOver:          boolean;
}

const EMPTY_STATE: GameState = {
  gameId:             null,
  status:             GameStatus.WAITING_FIRST_FLIP,
  gridSize:           0,
  difficulty:         1,
  entryFee:           0n,
  maxPayout:          0n,
  mineBitmask:        0n,
  revealedBitmask:    0n,
  safeRevealed:       0,
  totalSafe:          0,
  tileStates:         [],
  multiplier:         0,
  currentPayout:      0n,
  sessionKeyAddr:     null,
  startBlock:         0n,
  startedAt:          0n,
  isWaitingFirstFlip: false,
  isWaitingVRF:       false,
  isActive:           false,
  isCashedOut:        false,
  isGameOver:         false,
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

/** Minimum balance to attempt a sweep (avoid dust). */
const SWEEP_MIN_BALANCE = 10000n;

/**
 * After game end: send any remaining session key ETH back to the player, then clear the session key.
 * No-op if no session key or balance too low. Non-throwing; logs and clears on failure.
 */
async function sweepSessionKeyToPlayer(
  publicClient: ReturnType<typeof usePublicClient> | undefined,
  playerAddress: `0x${string}`,
): Promise<void> {
  const sessionKey = getSessionKey();
  if (!sessionKey || !publicClient) {
    clearSessionKey();
    return;
  }
  try {
    const balance = await publicClient.getBalance({ address: sessionKey.address });
    if (balance <= SWEEP_MIN_BALANCE) {
      clearSessionKey();
      return;
    }
    const gasPrice = await publicClient.getGasPrice();
    const gasReserve = 21000n * gasPrice * 2n;
    const valueToSend = balance > gasReserve ? balance - gasReserve : 0n;
    if (valueToSend <= 0n) {
      clearSessionKey();
      return;
    }
    const sessionClient = createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL);
    if (!sessionClient) {
      clearSessionKey();
      return;
    }
    const hash = await sessionClient.sendTransaction({
      to:   playerAddress,
      value: valueToSend,
      gas:  21000n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (e) {
    console.warn("[sweep] session key balance return failed:", e);
  } finally {
    clearSessionKey();
  }
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useGame() {
  const { address: playerAddress } = useAccount();
  const publicClient = usePublicClient();

  const [gameState, setGameState]         = useState<GameState>(EMPTY_STATE);
  const [pendingTile, setPendingTile]     = useState<number | null>(null);
  const [pendingTiles, setPendingTiles]   = useState<number[]>([]);
  const [mineHitTileIndex, setMineHitTileIndex] = useState<number | null>(null);
  const [explosionComplete, setExplosionComplete] = useState(true);
  const [isStarting, setIsStarting]       = useState(false);
  const [isCashingOut, setIsCashingOut]   = useState(false);
  const [isCancelling, setIsCancelling]   = useState(false);
  const [isFlipInFlight, setIsFlipInFlight] = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const sessionAcc = useRef(getOrCreateSessionKey());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTilesRef = useRef<number[]>([]);
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  pendingTilesRef.current = pendingTiles;

  const FLIP_BATCH_DELAY_MS = 100;

  // ── Current block number (for block-based cancel countdown) ───────────────
  const { data: currentBlock = 0n } = useBlockNumber({ watch: true });

  // ── Read active game for player ──────────────────────────────────────────
  const { data: activeGameId, refetch: refetchActiveGame } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "playerActiveGame",
    args:    [playerAddress ?? "0x0000000000000000000000000000000000000000"],
    query:   {
      enabled:        !!playerAddress,
      refetchInterval: 10_000,
    },
  });

  const currentGameId = gameState.gameId ?? (activeGameId && activeGameId > 0n ? activeGameId : null);

  // ── Read full game state ─────────────────────────────────────────────────
  const { data: rawGame, refetch: refetchGame } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "getGame",
    args:    [currentGameId ?? 0n],
    query:   {
      enabled:        !!currentGameId && currentGameId > 0n,
      refetchInterval: 6_000,
    },
  });

  // ── Clear pending when game goes ACTIVE (VRF resolved) or on unmount ───
  useEffect(() => {
    if (gameState.isActive) {
      setPendingTile(null);
      setPendingTiles([]);
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
    }
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    };
  }, [gameState.isActive]);

  // ── Sync rawGame → gameState ─────────────────────────────────────────────
  useEffect(() => {
    if (!rawGame || !currentGameId) return;

    const [
      , sessionKey, gridSize, difficulty, entryFee,
      maxPayout, mineBitmask, revealedBitmask,
      safeRevealed, totalSafe, statusNum, startBlock, startedAt,
    ] = rawGame;

    const status     = statusNum as GameStatus;
    const totalTiles = GRID_INFO[gridSize as 0|1|2].totalTiles;
    const mult       = calcMultiplier(safeRevealed, totalSafe, difficulty);
    const payout     = safeRevealed === 0
      ? 0n
      : (maxPayout * BigInt(safeRevealed)) / BigInt(totalSafe);

    const tiles = buildTileStates(totalTiles, revealedBitmask, mineBitmask);

    if (status !== GameStatus.GAME_OVER) {
      setMineHitTileIndex(null);
    }

    if (pendingTile !== null && tiles[pendingTile] === "unrevealed") {
      tiles[pendingTile] = "pending";
    }
    for (const i of pendingTiles) {
      if (i < tiles.length && tiles[i] === "unrevealed") tiles[i] = "pending";
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
      startBlock:     typeof startBlock === "bigint" ? startBlock : BigInt(Number(startBlock)),
      startedAt,
      isWaitingFirstFlip: status === GameStatus.WAITING_FIRST_FLIP,
      isWaitingVRF:       status === GameStatus.WAITING_VRF,
      isActive:           status === GameStatus.ACTIVE,
      isCashedOut:        status === GameStatus.CASHED_OUT,
      isGameOver:         status === GameStatus.GAME_OVER,
    });
  }, [rawGame, currentGameId, pendingTile, pendingTiles]);

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
      const value = entryFee + SESSION_GAS_BUDGET;

      // Single wallet popup: pays entry fee + gas budget, registers session key; contract forwards gas to session key
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESS,
        abi:          MINESWEEPER_ABI,
        functionName: "startGame",
        args:         [gridSize, difficulty, sk],
        value,
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
            status:             GameStatus.WAITING_FIRST_FLIP,
            isWaitingFirstFlip: true,
            isWaitingVRF:       false,
          }));
          refetchGame();
          refetchActiveGame();
        }
      }
    } catch (e: unknown) {
      setError(normalizeWalletError(e, "start the game"));
    } finally {
      setIsStarting(false);
    }
  }, [playerAddress, writeContractAsync, publicClient, refetchGame, refetchActiveGame]);

  // ─────────────────────────────────────────────────────────────────────────
  // Flip Tile(s)  (signed by session key – zero wallet popups)
  //
  // WAITING_FIRST_FLIP: one click → firstFlip() immediately (VRF trigger).
  // ACTIVE: clicks are batched; after FLIP_BATCH_DELAY_MS we send flipTiles()
  //         with all collected indices in one tx.
  // ─────────────────────────────────────────────────────────────────────────
  const flushBatch = useCallback(async () => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    const current = pendingTilesRef.current;
    if (current.length === 0) return;
    const g = gameStateRef.current;
    if (!g.gameId || !g.isActive) return;

    const tileIndices = [...new Set(current)].sort((a, b) => a - b) as readonly number[];
    setPendingTiles([]);
    setIsFlipInFlight(true);
    setError(null);
    try {
      const useSession = await canUseSessionKey(publicClient);
      const sessionClient = useSession ? createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL) : null;
      if (sessionClient) {
        const hash = await sessionClient.writeContract({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "flipTiles",
          args:         [g.gameId, tileIndices],
          gas:          GAS_LIMIT_FLIP_TILES,
        });
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt?.logs) {
          const logs = parseEventLogs({ abi: MINESWEEPER_ABI, logs: receipt.logs });
          const gameOver = logs.find((l) => l.eventName === "GameOver");
          if (gameOver) {
            const { mineTile } = (gameOver.args as { mineTile: number });
            setMineHitTileIndex(mineTile);
            setExplosionComplete(false);
          }
        }
      } else {
        const hash = await writeContractAsync({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "flipTiles",
          args:         [g.gameId, tileIndices],
        });
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt?.logs) {
          const logs = parseEventLogs({ abi: MINESWEEPER_ABI, logs: receipt.logs });
          const gameOver = logs.find((l) => l.eventName === "GameOver");
          if (gameOver) {
            const { mineTile } = (gameOver.args as { mineTile: number });
            setMineHitTileIndex(mineTile);
            setExplosionComplete(false);
          }
        }
      }
      await refetchGame();
      if (publicClient && g.gameId) {
        const raw = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi:     MINESWEEPER_ABI,
          functionName: "getGame",
          args:    [g.gameId],
        });
        const status = Number((raw as readonly unknown[])[10]);
        if (status === GameStatus.CASHED_OUT || status === GameStatus.GAME_OVER) {
          if (playerAddress) {
            await sweepSessionKeyToPlayer(publicClient, playerAddress);
          } else {
            clearSessionKey();
          }
        }
      }
    } catch (e: unknown) {
      setError(normalizeWalletError(e));
    } finally {
      setIsFlipInFlight(false);
    }
  }, [publicClient, playerAddress, refetchGame, writeContractAsync]);

  const flipTile = useCallback((tileIndex: number) => {
    const gameId = gameState.gameId;
    if (!gameId) return;
    const isFirstFlip = gameState.isWaitingFirstFlip;
    if (!isFirstFlip && !gameState.isActive) return;
    if (gameState.tileStates[tileIndex] !== "unrevealed") return;

    setError(null);

    if (isFirstFlip) {
      setPendingTile(tileIndex);
      (async () => {
        try {
          const fnName = "firstFlip";
          const useSession = await canUseSessionKey(publicClient);
          const sessionClient = useSession ? createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL) : null;
          if (sessionClient) {
            const hash = await sessionClient.writeContract({
              address:      CONTRACT_ADDRESS,
              abi:          MINESWEEPER_ABI,
              functionName: fnName,
              args:         [gameId, tileIndex],
              gas:          GAS_LIMIT_FIRST_FLIP,
            });
            await publicClient?.waitForTransactionReceipt({ hash });
          } else {
            await writeContractAsync({
              address:      CONTRACT_ADDRESS,
              abi:          MINESWEEPER_ABI,
              functionName: fnName,
              args:         [gameId, tileIndex],
            });
          }
          await refetchGame();
          if (publicClient) {
            const raw = await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi:     MINESWEEPER_ABI,
              functionName: "getGame",
              args:    [gameId],
            });
            const status = Number((raw as readonly unknown[])[10]);
            if (status === GameStatus.CASHED_OUT || status === GameStatus.GAME_OVER) {
              if (playerAddress) await sweepSessionKeyToPlayer(publicClient, playerAddress);
              else clearSessionKey();
            }
          }
        } catch (e: unknown) {
          setError(normalizeWalletError(e));
        } finally {
          setPendingTile(null);
        }
      })();
      return;
    }

    // ACTIVE: add to batch and start/reset delay timer
    setPendingTiles((prev) => (prev.includes(tileIndex) ? prev : [...prev, tileIndex]));
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(() => {
      flushBatch();
    }, FLIP_BATCH_DELAY_MS);
  }, [gameState, writeContractAsync, publicClient, playerAddress, refetchGame, flushBatch]);

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
      const useSession = await canUseSessionKey(publicClient);
      const sessionClient = useSession ? createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL) : null;

      if (sessionClient) {
        const hash = await sessionClient.writeContract({
          address:      CONTRACT_ADDRESS,
          abi:          MINESWEEPER_ABI,
          functionName: "cashOut",
          args:         [gameState.gameId],
          gas:          GAS_LIMIT_CASH_OUT,
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
      if (playerAddress) {
        await sweepSessionKeyToPlayer(publicClient ?? undefined, playerAddress);
      } else {
        clearSessionKey();
      }
    } catch (e: unknown) {
      setError(normalizeWalletError(e, "cash out"));
    } finally {
      setIsCashingOut(false);
    }
  }, [gameState, writeContractAsync, publicClient, playerAddress, refetchGame, refetchActiveGame]);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Cancel Stuck Game (only before first flip, after 100 blocks; only player or owner)
  const cancelGame = useCallback(async (): Promise<boolean> => {
    if (!gameState.gameId) return false;
    setError(null);
    setIsCancelling(true);
    try {
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESS,
        abi:          MINESWEEPER_ABI,
        functionName: "cancelStuckGame",
        args:         [gameState.gameId],
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      if (playerAddress) {
        await sweepSessionKeyToPlayer(publicClient ?? undefined, playerAddress);
      } else {
        clearSessionKey();
      }
      setGameState(EMPTY_STATE);
      setError(null);
      await refetchActiveGame();
      return true;
    } catch (e: unknown) {
      setError(normalizeWalletError(e, "cancel the game"));
      return false;
    } finally {
      setIsCancelling(false);
    }
  }, [gameState.gameId, writeContractAsync, publicClient, playerAddress, refetchActiveGame]);

  // ── Reset (start over after win/loss) ────────────────────────────────────
  const resetGame = useCallback(() => {
    setGameState(EMPTY_STATE);
    setMineHitTileIndex(null);
    setExplosionComplete(true);
    setError(null);
    clearSessionKey();
    refetchActiveGame();
  }, [refetchActiveGame]);

  // ── Block-based cancel eligibility (only before first flip; no cancel once game started) ──
  const cancelBlockDataReady = gameState.startBlock > 0n;
  const cancelThresholdBlocks = CANCEL_BLOCKS_WAITING_FIRST_FLIP;
  const cancelBlock = gameState.startBlock + BigInt(cancelThresholdBlocks);
  const canCancel =
    gameState.isWaitingFirstFlip &&
    cancelBlockDataReady &&
    currentBlock > 0n &&
    cancelBlock > 0n &&
    currentBlock > cancelBlock;
  const blocksUntilCancel =
    gameState.isWaitingFirstFlip &&
    cancelBlockDataReady &&
    currentBlock > 0n &&
    cancelBlock > currentBlock
      ? Number(cancelBlock - currentBlock)
      : 0;

  const onExplosionComplete = useCallback(() => {
    setExplosionComplete(true);
  }, []);

  return {
    gameState,
    isStarting,
    isCashingOut,
    isCancelling,
    pendingTile,
    isFlipInFlight,
    error,
    explosionComplete,
    mineHitTileIndex,
    onExplosionComplete,
    sessionKeyAddr: sessionAcc.current.address,
    currentBlock:   currentBlock,
    startBlock:      gameState.startBlock,
    cancelBlockDataReady,
    blocksUntilCancel,
    canCancel,
    cancelThresholdBlocks,
    startGame,
    flipTile,
    cashOut,
    cancelGame,
    resetGame,
    refetchGame,
  };
}
