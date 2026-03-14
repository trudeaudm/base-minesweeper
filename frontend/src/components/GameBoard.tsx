import { Tile } from "./Tile";
import { type TileState } from "@/hooks/useGame";
import { GameStatus, GRID_INFO } from "@/lib/config";

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

export function GameBoard({
  gridSize,
  tileStates,
  mineBitmask,
  status,
  onFlip,
  isCashout = false,
}: GameBoardProps) {
  const info = GRID_INFO[gridSize as 0 | 1 | 2];

  // Tiles are clickable in WAITING_FIRST_FLIP and ACTIVE states.
  const active       = status === GameStatus.ACTIVE || status === GameStatus.WAITING_FIRST_FLIP;
  const isWaitingVRF = status === GameStatus.WAITING_VRF;
  const isGameOver   = status === GameStatus.GAME_OVER;
  const isWinReveal  = status === GameStatus.CASHED_OUT;

  return (
    <div
      className="w-full max-w-xs mx-auto"
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
            isGameOver={isGameOver && state === "unrevealed"}
            isWinReveal={isWinReveal && state === "unrevealed"}
          />
        ))}
      </div>
    </div>
  );
}
