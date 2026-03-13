import { Tile } from "./Tile";
import { type TileState } from "@/hooks/useGame";
import { GameStatus, GRID_INFO } from "@/lib/config";

interface GameBoardProps {
  gridSize:   number;
  tileStates: TileState[];
  status:     GameStatus;
  onFlip:     (index: number) => void;
  isCashout?: boolean;
}

export function GameBoard({
  gridSize,
  tileStates,
  status,
  onFlip,
  isCashout = false,
}: GameBoardProps) {
  const info   = GRID_INFO[gridSize as 0 | 1 | 2];
  const active = status === GameStatus.ACTIVE;

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
            state={state}
            onClick={onFlip}
            disabled={!active || state !== "unrevealed"}
            isCashout={isCashout && active}
          />
        ))}
      </div>
    </div>
  );
}
