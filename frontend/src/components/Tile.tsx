import { type TileState } from "@/hooks/useGame";
import { BaseMineIcon } from "./BaseLogo";

interface TileProps {
  index:      number;
  state:      TileState;
  onClick:    (index: number) => void;
  disabled:   boolean;
  isCashout?: boolean; // pulsing cashout state
}

// Classic minesweeper number colors
const NUMBER_COLORS = [
  "",              // 0 — blank
  "text-blue-400", // 1
  "text-green-400",// 2
  "text-red-400",  // 3
  "text-blue-700", // 4
  "text-red-700",  // 5
  "text-cyan-400", // 6
  "text-black",    // 7
  "text-gray-400", // 8
];

export function Tile({
  index,
  state,
  onClick,
  disabled,
  isCashout = false,
}: TileProps) {
  const handleClick = () => {
    if (!disabled && state === "unrevealed") {
      onClick(index);
    }
  };

  // ── Style by state ────────────────────────────────────────────────────────
  if (state === "mine") {
    return (
      <div
        className="
          relative flex items-center justify-center
          rounded-md w-full aspect-square
          bg-mine shadow-tile-mine
          animate-mine-reveal cursor-default
          border border-red-300/30
        "
      >
        <BaseMineIcon size={24} />
      </div>
    );
  }

  if (state === "safe") {
    return (
      <div
        className="
          relative flex items-center justify-center
          rounded-md w-full aspect-square
          bg-neutral-800 border border-white/10
          shadow-tile-safe cursor-default
          animate-tile-flip
        "
      >
        <span className={`text-xs font-bold font-mono ${NUMBER_COLORS[1]}`}>
          {/* Safe tile — blank for now; could show adjacent mine count */}
        </span>
      </div>
    );
  }

  if (state === "pending") {
    return (
      <div
        className="
          relative flex items-center justify-center
          rounded-md w-full aspect-square
          bg-blue-700/60 border border-base-blue/50
          cursor-wait
        "
      >
        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // unrevealed
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`
        relative flex items-center justify-center
        rounded-md w-full aspect-square
        transition-all duration-150
        border border-blue-400/20
        shadow-tile
        ${disabled
          ? "cursor-not-allowed opacity-60 bg-base-blue"
          : "cursor-pointer bg-base-blue hover:bg-blue-500 active:scale-95 hover:shadow-cashout"
        }
        ${isCashout && !disabled ? "animate-pulse-slow" : ""}
      `}
      aria-label={`Tile ${index}`}
    />
  );
}
