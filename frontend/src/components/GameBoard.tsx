import { useEffect, useMemo, useState } from "react";
import { Tile } from "./Tile";
import { BaseCircleLogo } from "./BaseLogo";
import { type TileState } from "@/hooks/useGame";
import { GameStatus, GRID_INFO } from "@/lib/config";

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

interface GameBoardProps {
  gridSize:    number;
  tileStates:  TileState[];
  mineBitmask: bigint;
  status:      GameStatus;
  onFlip:      (index: number) => void;
  isCashout?:  boolean;
}

/** Count mines in the 8 neighbours of tile at `index` in a grid of width `cols`. */
function adjacentMineCount(
  index:       number,
  cols:        number,
  totalTiles:  number,
  mineBitmask: bigint
): number {
  const row = Math.floor(index / cols);
  const col = index % cols;
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nc < 0 || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (ni >= totalTiles) continue;
      if (((mineBitmask >> BigInt(ni)) & 1n) === 1n) count++;
    }
  }
  return count;
}

const VRF_BOUNCE_COUNT = 6;
const VRF_BOUNCE_MS = 380;

export function GameBoard({
  gridSize,
  tileStates,
  mineBitmask,
  status,
  onFlip,
  isCashout = false,
}: GameBoardProps) {
  const info = GRID_INFO[gridSize as 0 | 1 | 2];

  const active       = status === GameStatus.ACTIVE || status === GameStatus.WAITING_FIRST_FLIP;
  const isWaitingVRF = status === GameStatus.WAITING_VRF;
  const isGameOver   = status === GameStatus.GAME_OVER;
  const isWinReveal  = status === GameStatus.CASHED_OUT;

  // Pseudo-random bounce sequence: 5–8 unrevealed tile indices, stable for this VRF wait.
  const bounceSequence = useMemo(() => {
    if (!isWaitingVRF) return [];
    const unrevealed = tileStates
      .map((s, i) => i)
      .filter((i) => tileStates[i] === "unrevealed");
    const count = Math.max(5, Math.min(8, unrevealed.length));
    const shuffled = shuffleWithSeed(unrevealed, Date.now());
    return shuffled.slice(0, count);
  }, [isWaitingVRF]); // eslint-disable-line react-hooks/exhaustive-deps -- freeze sequence when VRF starts

  const [bounceStep, setBounceStep] = useState(0);

  useEffect(() => {
    if (!isWaitingVRF || bounceSequence.length === 0) {
      setBounceStep(0);
      return;
    }
    setBounceStep(0);
    const id = setInterval(() => {
      setBounceStep((prev) => (prev < bounceSequence.length - 1 ? prev + 1 : prev));
    }, VRF_BOUNCE_MS);
    return () => clearInterval(id);
  }, [isWaitingVRF, bounceSequence.length]);

  const currentBounceTileIndex =
    isWaitingVRF && bounceSequence.length > 0
      ? bounceSequence[bounceStep] ?? bounceSequence[0]
      : -1;

  const { cols, rows } = info;
  const logoLeftPct =
    currentBounceTileIndex >= 0
      ? ((currentBounceTileIndex % cols) + 0.5) / cols * 100
      : 50;
  const logoTopPct =
    currentBounceTileIndex >= 0
      ? (Math.floor(currentBounceTileIndex / cols) + 0.5) / rows * 100
      : 50;

  return (
    <div
      className="w-full max-w-xs mx-auto relative"
      role="grid"
      aria-label="Minesweeper board"
    >
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${info.cols}, 1fr)` }}
      >
        {tileStates.map((state, i) => (
          <Tile
            key={i}
            index={i}
            cols={info.cols}
            state={state}
            adjacentCount={
              state === "safe"
                ? adjacentMineCount(i, info.cols, info.totalTiles, mineBitmask)
                : undefined
            }
            onClick={onFlip}
            disabled={!active || state !== "unrevealed"}
            isCashout={isCashout && active}
            isWaitingVRF={isWaitingVRF && state === "unrevealed"}
            isHighlighted={currentBounceTileIndex === i}
            isGameOver={isGameOver && state === "unrevealed"}
            isWinReveal={isWinReveal && state === "unrevealed"}
          />
        ))}
      </div>

      {/* VRF waiting: bouncing Base circle logo with spinning bar */}
      {isWaitingVRF && bounceSequence.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden
        >
          <div
            className="absolute w-7 h-7 transition-all duration-300 ease-out"
            style={{
              left: `${logoLeftPct}%`,
              top: `${logoTopPct}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <BaseCircleLogo size={28} spinBar />
          </div>
        </div>
      )}
    </div>
  );
}
