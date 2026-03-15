import type { RefObject } from "react";
import { useEffect, useState, useRef } from "react";
import { Tile } from "./Tile";
import { type TileState } from "@/hooks/useGame";
import { GameStatus } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

// ─── Explosion sequence (easy to tweak) ─────────────────────────────────────
const EXPLOSION_STAGGER_MS = 150;
const EXPLOSION_DURATION_MS = 250;
const EXPLOSION_SETTLE_MS = 700;  // pause after last explosion before "you lose" overlay

const BURST_STAGGER_MS = 80;  // delay between each tile burst reveal

/** Shuffle array with a simple PRNG (seeded for stable sequence). */
function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Collect all tile indices where mine bit is set. */
function getMineIndices(mineBitmask: bigint, totalTiles: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < totalTiles; i++) {
    if (((mineBitmask >> BigInt(i)) & 1n) === 1n) out.push(i);
  }
  return out;
}

export type TileFlyDirection = "left" | "right" | "up" | "down";

export interface GameBoardProps {
  gridSize:               number;
  tileStates:             TileState[];
  mineBitmask:            bigint;
  revealedAdjacency:      number[]; // per-tile adjacent mine count (0-8) from contract
  status:                 GameStatus;
  onFlip:                 (index: number) => void;
  isCashout?:             boolean;
  pendingTilesRef?:       RefObject<number[]>;
  isFlipPending?:         boolean;  // true when flip tx in flight (after 50ms debounce)
  burstRevealOrder?:      number[];  // tile indices in click order for burst reveal
  onBurstRevealComplete?: () => void;
  mineHitTileIndex?:      number | null;
  onExplosionComplete?:   () => void;
  explosionComplete?:     boolean;  // true when mine-reveal sequence has finished (used to re-enable pointer events)
}

/** Deterministic per-tile fly direction (randomized per index). */
function getFlyDirection(index: number): TileFlyDirection {
  const dirs: TileFlyDirection[] = ["left", "right", "up", "down"];
  const seed = (index * 1103515245 + 12345) & 0x7fffffff;
  return dirs[seed % 4];
}

const TILE_SHAKE_INTERVAL_MS = 2600;
const TILE_SHAKE_COUNT = 3;

export type ExplosionPhase = "pending" | "exploding" | "exploded";

export function GameBoard({
  gridSize,
  tileStates,
  mineBitmask,
  revealedAdjacency,
  status,
  onFlip,
  isCashout = false,
  pendingTilesRef,
  isFlipPending = false,
  burstRevealOrder = [],
  onBurstRevealComplete,
  mineHitTileIndex = null,
  onExplosionComplete,
  explosionComplete = true,
}: GameBoardProps) {
  const { gridInfo } = useGridConfigs();
  const info = gridInfo?.[gridSize as 0 | 1 | 2];
  if (!info) return null; // grid config not loaded yet

  const active       = status === GameStatus.ACTIVE || status === GameStatus.WAITING_FIRST_FLIP;
  const isWaitingVRF = status === GameStatus.WAITING_VRF;
  const isGameOver   = status === GameStatus.GAME_OVER;
  const isWinReveal  = status === GameStatus.CASHED_OUT;

  const [explodingTiles, setExplodingTiles] = useState<Set<number>>(new Set());
  const [explodedTiles, setExplodedTiles]   = useState<Set<number>>(new Set());
  const [screenShake, setScreenShake]       = useState(false);
  const [shakingTiles, setShakingTiles]     = useState<Set<number>>(new Set());
  const [currentBurstIndex, setCurrentBurstIndex] = useState(0);
  const explosionOrderRef = useRef<number[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tileStatesRef = useRef<TileState[]>(tileStates);
  tileStatesRef.current = tileStates;

  // Staggered burst reveal: advance currentBurstIndex every BURST_STAGGER_MS, then clear
  useEffect(() => {
    if (!burstRevealOrder.length || !onBurstRevealComplete) return;
    setCurrentBurstIndex(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCurrentBurstIndex(i);
      if (i >= burstRevealOrder.length) {
        clearInterval(id);
        onBurstRevealComplete();
      }
    }, BURST_STAGGER_MS);
    return () => clearInterval(id);
  }, [burstRevealOrder, onBurstRevealComplete]);

  useEffect(() => {
    if (status !== GameStatus.GAME_OVER || mineHitTileIndex == null || !onExplosionComplete) {
      if (status !== GameStatus.GAME_OVER) {
        setExplodingTiles(new Set());
        setExplodedTiles(new Set());
        setScreenShake(false);
      }
      return;
    }

    const totalTiles = info.totalTiles;
    const mineIndices = getMineIndices(mineBitmask, totalTiles);
    if (mineIndices.length === 0) {
      onExplosionComplete();
      return;
    }

    const rest = mineIndices.filter((i) => i !== mineHitTileIndex);
    const order: number[] = [mineHitTileIndex, ...shuffleWithSeed(rest, Date.now())];
    explosionOrderRef.current = order;

    setExplodedTiles(new Set());
    setExplodingTiles(new Set([order[0]]));
    setScreenShake(true);
    const shakeEnd = setTimeout(() => setScreenShake(false), 300);
    timeoutsRef.current.push(shakeEnd);

    order.forEach((tileIndex, i) => {
      const startAt = i * EXPLOSION_STAGGER_MS;
      const startTimeout = setTimeout(() => {
        setExplodingTiles((prev) => new Set(prev).add(tileIndex));
      }, startAt);
      timeoutsRef.current.push(startTimeout);

      const endTimeout = setTimeout(() => {
        setExplodingTiles((prev) => {
          const next = new Set(prev);
          next.delete(tileIndex);
          return next;
        });
        setExplodedTiles((prev) => new Set(prev).add(tileIndex));
      }, startAt + EXPLOSION_DURATION_MS);
      timeoutsRef.current.push(endTimeout);
    });

    const lastStart = (order.length - 1) * EXPLOSION_STAGGER_MS;
    const settleThenComplete = setTimeout(() => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
      setExplodingTiles(new Set());
      onExplosionComplete();
    }, lastStart + EXPLOSION_DURATION_MS + EXPLOSION_SETTLE_MS);
    timeoutsRef.current.push(settleThenComplete);

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [status, mineHitTileIndex, onExplosionComplete, mineBitmask, info.totalTiles]);

  const getExplosionPhase = (tileIndex: number): ExplosionPhase | undefined => {
    if (status !== GameStatus.GAME_OVER || mineHitTileIndex == null) return undefined;
    const order = explosionOrderRef.current;
    if (!order.includes(tileIndex)) return undefined;
    if (explodedTiles.has(tileIndex)) return "exploded";
    if (explodingTiles.has(tileIndex)) return "exploding";
    return "pending";
  };

  // Random unrevealed tiles shake periodically during active play
  useEffect(() => {
    if (!active || isWaitingVRF || isGameOver) {
      setShakingTiles(new Set());
      return;
    }
    const pick = () => {
      const states = tileStatesRef.current;
      const unrevealed = states
        .map((_, i) => i)
        .filter((i) => states[i] === "unrevealed");
      if (unrevealed.length === 0) return;
      const count = Math.min(TILE_SHAKE_COUNT, unrevealed.length);
      const shuffled = shuffleWithSeed([...unrevealed], Date.now());
      setShakingTiles(new Set(shuffled.slice(0, count)));
    };
    pick();
    const id = setInterval(pick, TILE_SHAKE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, isWaitingVRF, isGameOver]);

  // Suppress all board clicks when game over until mine reveal sequence completes (BUG 4: prevent clicks from cancelling reveal)
  const suppressClicks = isGameOver && mineHitTileIndex != null && !explosionComplete;

  return (
    <div
      className={`w-full max-w-xs mx-auto relative ${screenShake ? "animate-screen-shake" : ""} ${suppressClicks ? "pointer-events-none" : ""}`}
      role="grid"
      aria-label="Minesweeper board"
    >
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${info.cols}, 1fr)` }}
      >
        {tileStates.map((state, i) => {
          const burstIdx = burstRevealOrder.indexOf(i);
          const disabled =
            isGameOver ||
            isWinReveal ||
            state !== "unrevealed" ||
            isFlipPending;
          return (
            <Tile
              key={i}
              index={i}
              cols={info.cols}
              state={state}
              pendingIndicesRef={pendingTilesRef}
              adjacentCount={
                state === "safe" && revealedAdjacency[i] !== undefined
                  ? revealedAdjacency[i]
                  : undefined
              }
              onClick={onFlip}
              disabled={disabled}
              isCashout={isCashout && active}
              isWaitingVRF={false}
              flyDirection={undefined}
              isHighlighted={false}
              isGameOver={isGameOver && state === "unrevealed"}
              isWinReveal={isWinReveal && state === "unrevealed"}
              explosionPhase={getExplosionPhase(i)}
              isShaking={shakingTiles.has(i)}
              burstOrderIndex={burstIdx >= 0 ? burstIdx : null}
              currentBurstIndex={currentBurstIndex}
            />
          );
        })}
      </div>
    </div>
  );
}
