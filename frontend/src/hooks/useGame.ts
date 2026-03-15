import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
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
  calcMultiplier,
  getMaxPayoutWei,
  MINE_COUNTS,
  CANCEL_BLOCKS_WAITING_VRF,
} from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";
import {
  getOrCreateSessionKey,
  getSessionKey,
  clearSessionKey,
  createSessionWalletClient,
} from "@/lib/session";
import type { PublicClient } from "viem";

// Explicit gas limits for session-key txs (avoid "gas required exceeds allowance (0)" when estimation fails)
const GAS_LIMIT_FIRST_FLIP = 300_000n;  // firstFlip places mines + reveals (sync; VRF already on-chain)
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
  revealedAdjacency:   number[]; // per-tile adjacent mine count (0-8) from contract; only set for revealed safe tiles
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
  revealedAdjacency:  [],
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
    if (process.env.NODE_ENV === "development") {
      console.warn("[sweep] session key balance return failed:", e);
    }
  } finally {
    clearSessionKey();
  }
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useGame() {
  const { address: playerAddress } = useAccount();
  const publicClient = usePublicClient();

  const [gameState, setGameState]         = useState<GameState>(EMPTY_STATE);
  const [pendingTiles, setPendingTiles]   = useState<number[]>([]);
  const [mineHitTileIndex, setMineHitTileIndex] = useState<number | null>(null);
  const [explosionComplete, setExplosionComplete] = useState(true);
  const [isStarting, setIsStarting]       = useState(false);
  const [isCashingOut, setIsCashingOut]   = useState(false);
  const [isCancelling, setIsCancelling]   = useState(false);
  const [isFlipInFlight, setIsFlipInFlight] = useState(false);
  const [tilesLockedForFlip, setTilesLockedForFlip] = useState(false); // BUG 2: set true ONLY inside 50ms setTimeout callback, never in click handler
  const [error, setError]                 = useState<string | null>(null);
  const sessionAcc = useRef(getOrCreateSessionKey());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTilesRef = useRef<number[]>([]);
  const lastFlipClickOrderRef = useRef<number[]>([]);
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  pendingTilesRef.current = pendingTiles;

  const [burstRevealOrder, setBurstRevealOrder] = useState<number[]>([]);

  const { gridInfo } = useGridConfigs();
  const FLIP_BATCH_DELAY_MS = 1000;

  // ── Current block number (for block-based cancel countdown) ───────────────
  // Poll block number instead of watch (avoids "filter not found" on Alchemy/HTTP RPCs)
  const { data: currentBlock = 0n } = useBlockNumber({
    watch: false,
    query: { refetchInterval: 12_000 },
  });

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
  const { data: rawGame, isLoading: isGetGameLoading, refetch: refetchGame } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "getGame",
    args:    [currentGameId ?? 0n],
    query:   {
      enabled:        !!currentGameId && currentGameId > 0n,
      refetchInterval: 6_000,
    },
  });

  // Board only when status has left WAITING_VRF (so WAITING_FIRST_FLIP or ACTIVE/ended) AND game data synced from contract.
  const isGameDataReady =
    !!currentGameId &&
    currentGameId > 0n &&
    rawGame != null &&
    !isGetGameLoading &&
    gameState.status !== GameStatus.WAITING_VRF &&
    gameState.entryFee > 0n &&
    gameState.maxPayout > 0n &&
    (gameState.gridSize === 0 || gameState.gridSize === 1 || gameState.gridSize === 2) &&
    gameState.totalSafe > 0;

  // ── Clear pending when game goes ACTIVE (first flip resolved) or on unmount ───
  useEffect(() => {
    if (gameState.isActive) {
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
    if (!rawGame || !currentGameId || !gridInfo) return;

    const [
      , sessionKey, gridSize, difficulty, entryFee,
      maxPayout, revealedMineBitmask, revealedBitmask,
      safeRevealed, totalSafe, statusNum, startBlock, startedAt,
      , // endedAt — not used in frontend
      revealedAdjacencyRaw,
    ] = rawGame;
    const mineBitmask = revealedMineBitmask;
    const revealedAdjacency = Array.isArray(revealedAdjacencyRaw)
      ? revealedAdjacencyRaw.map((n: unknown) => Number(n))
      : [];

    const status     = statusNum as GameStatus;
    const totalTiles = gridInfo?.[gridSize as 0|1|2]?.totalTiles ?? 0;
    const mult       = calcMultiplier(safeRevealed, totalSafe, difficulty);
    const payout     = safeRevealed === 0
      ? 0n
      : (maxPayout * BigInt(safeRevealed)) / BigInt(totalSafe);

    const tiles = buildTileStates(totalTiles, revealedBitmask, mineBitmask);

    if (status !== GameStatus.GAME_OVER) {
      setMineHitTileIndex(null);
    }

    // Use ref so pending state is applied as soon as ref is updated (same tick as click), not only when state flushes.
    for (const i of pendingTilesRef.current) {
      if (i < tiles.length && tiles[i] === "unrevealed") tiles[i] = "pending";
    }

    if (lastFlipClickOrderRef.current.length > 0) {
      const order = lastFlipClickOrderRef.current.filter(
        (i) => i < totalTiles && (revealedBitmask & (1n << BigInt(i))) !== 0n
      );
      if (order.length > 0) setBurstRevealOrder(order);
      lastFlipClickOrderRef.current = [];
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
      revealedAdjacency,
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
  }, [rawGame, currentGameId, pendingTiles, gridInfo]);

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

      const cfg = gridInfo?.[gridSize as 0|1|2];
      if (!cfg) throw new Error("Grid config not loaded");
      const value = cfg.entryFee + SESSION_GAS_BUDGET;

      // Single wallet popup: pays entry fee + gas budget, registers session key; contract forwards gas to session key
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESS,
        abi:          MINESWEEPER_ABI,
        functionName: "startGame",
        args:         [gridSize, difficulty, sk],
        value,  // cfg.entryFee + SESSION_GAS_BUDGET (must match contract)
      });

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const logs = parseEventLogs({ abi: MINESWEEPER_ABI, logs: receipt.logs });
        const started = logs.find(l => l.eventName === "GameStarted");
        if (started) {
          const gameId = (started.args as { gameId: bigint }).gameId;
          setPendingTiles([]);
          pendingTilesRef.current = [];
          setTilesLockedForFlip(false);
          setIsFlipInFlight(false);
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current);
            batchTimerRef.current = null;
          }
          const totalTiles = cfg.totalTiles;
          const totalSafe = totalTiles - MINE_COUNTS[gridSize as 0|1|2][difficulty as 0|1|2];
          const maxPayout = getMaxPayoutWei(cfg.entryFee, difficulty);
          setGameState(prev => ({
            ...prev,
            gameId,
            status:             GameStatus.WAITING_VRF,
            isWaitingFirstFlip: false,
            isWaitingVRF:       true,
            gridSize,
            difficulty,
            entryFee:           cfg.entryFee,
            maxPayout,
            totalSafe,
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
  }, [playerAddress, writeContractAsync, publicClient, refetchGame, refetchActiveGame, gridInfo]);

  // ─────────────────────────────────────────────────────────────────────────
  // Flip Tile(s)  (signed by session key – zero wallet popups)
  //
  // WAITING_FIRST_FLIP: one click → firstFlip() immediately (VRF trigger).
  // ACTIVE: clicks are batched; after FLIP_BATCH_DELAY_MS we send flipTiles()
  //         with all collected indices in one tx.
  // ─────────────────────────────────────────────────────────────────────────
  const flushBatch = useCallback(async () => {
    // Lock all unrevealed tiles, so no new clicks until tx completes.
    setTilesLockedForFlip(true);
    // Clear the 50ms debounce timer; we are now executing the batch (no further resets).
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    // Snapshot current batch of tile indices (ref is source of truth at timer fire).
    const current = pendingTilesRef.current;
    if (current.length === 0) return;
    const g = gameStateRef.current;
    if (!g.gameId) return;

    pendingTilesRef.current = [];
    setPendingTiles([]);
    setError(null);
    setIsFlipInFlight(true);

    const isFirstFlip = g.isWaitingFirstFlip && current.length >= 1;
    const tileIndex = current[0];

    try {
      const useSession = await canUseSessionKey(publicClient);
      const sessionClient = useSession ? createSessionWalletClient(SUPPORTED_CHAIN, RPC_URL) : null;

      if (isFirstFlip) {
        if (sessionClient) {
          const hash = await sessionClient.writeContract({
            address:      CONTRACT_ADDRESS,
            abi:          MINESWEEPER_ABI,
            functionName: "firstFlip",
            args:         [g.gameId, tileIndex],
            gas:          GAS_LIMIT_FIRST_FLIP,
          });
          await publicClient?.waitForTransactionReceipt({ hash });
        } else {
          await writeContractAsync({
            address:      CONTRACT_ADDRESS,
            abi:          MINESWEEPER_ABI,
            functionName: "firstFlip",
            args:         [g.gameId, tileIndex],
          });
        }
      } else {
        if (!g.isActive) return;
        // Store click order for burst-reveal animation (tiles reveal in order user clicked).
        lastFlipClickOrderRef.current = [...current];
        const tileIndices = [...new Set(current)].sort((a, b) => a - b) as readonly number[];
    // Clear pending state immediately so UI stops showing pending animation and we don’t double-send.
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
      }

      await refetchGame();
      // If game ended (cashed out or hit mine), sweep session key balance back to player and clear key.
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
      // Unlock tiles so user can click again (and so next batch can run if they click).
      setTilesLockedForFlip(false);
      setIsFlipInFlight(false);
    }
  }, [publicClient, playerAddress, refetchGame, writeContractAsync]);

  const flipTile = useCallback((tileIndex: number) => {
    const gameId = gameState.gameId;
    if (!gameId) return;
    // Ignore all clicks while VRF is in flight — tiles are disabled; prevent any restart of first-click state.
    if (gameState.status === GameStatus.WAITING_VRF) return;
    const isFirstFlip = gameState.isWaitingFirstFlip;
    // If not first flip, we must be in ACTIVE state to accept clicks.
    if (!isFirstFlip && !gameState.isActive) return;
    // Only allow flipping unrevealed tiles (ignore safe/mine/pending).
    if (gameState.tileStates[tileIndex] !== "unrevealed") return;

    setError(null);

    if (isFirstFlip) {
      // First click: single tile in batch; flushBatch will call firstFlip() (sync, VRF already on-chain).
      const next = [tileIndex];
      pendingTilesRef.current = next;
      flushSync(() => setPendingTiles(next));
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      batchTimerRef.current = setTimeout(() => flushBatch(), FLIP_BATCH_DELAY_MS);
      return;
    }

    // ── ACTIVE: batch this click with others; send one flipTiles() after debounce. ──
    // Build next batch: add tileIndex if not already present (idempotent for same tile).
    const next = pendingTilesRef.current.includes(tileIndex)
      ? pendingTilesRef.current
      : [...pendingTilesRef.current, tileIndex];
    // Update ref first so pendingIndicesRef.current includes this index before any re-render (Tile uses it for showAsPending).
    pendingTilesRef.current = next;
    // Force synchronous re-render so board shows pending state; isFlipPending stays false until flushBatch runs.
    flushSync(() => setPendingTiles(next));
    // Reset the 50ms debounce: each new click restarts the timer so we batch rapid clicks into one tx.
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(() => {
      flushBatch();
    }, FLIP_BATCH_DELAY_MS);
  }, [gameState, flushBatch]);

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
    setBurstRevealOrder([]);
    lastFlipClickOrderRef.current = [];
    setError(null);
    setPendingTiles([]);
    pendingTilesRef.current = [];
    setTilesLockedForFlip(false);
    setIsFlipInFlight(false);
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    clearSessionKey();
    refetchActiveGame();
  }, [refetchActiveGame]);

  // ── Block-based cancel eligibility (only while stuck in WAITING_VRF after startGame) ──
  const cancelBlockDataReady = gameState.startBlock > 0n;
  const cancelThresholdBlocks = CANCEL_BLOCKS_WAITING_VRF;
  const cancelBlock = gameState.startBlock + BigInt(cancelThresholdBlocks);
  const canCancel =
    gameState.isWaitingVRF &&
    cancelBlockDataReady &&
    currentBlock > 0n &&
    cancelBlock > 0n &&
    currentBlock > cancelBlock;
  const blocksUntilCancel =
    gameState.isWaitingVRF &&
    cancelBlockDataReady &&
    currentBlock > 0n &&
    cancelBlock > currentBlock
      ? Number(cancelBlock - currentBlock)
      : 0;

  const onExplosionComplete = useCallback(() => {
    setExplosionComplete(true);
  }, []);

  const onBurstRevealComplete = useCallback(() => {
    setBurstRevealOrder([]);
  }, []);

  const isFlipPending = tilesLockedForFlip;

  return {
    gameState,
    isGameDataReady,
    isStarting,
    isCashingOut,
    isCancelling,
    pendingTiles,
    pendingTilesRef,
    isFlipPending,
    isFlipInFlight,
    burstRevealOrder,
    onBurstRevealComplete,
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
