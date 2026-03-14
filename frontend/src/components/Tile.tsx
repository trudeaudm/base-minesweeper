import { type TileState } from "@/hooks/useGame";
import { BaseMineIcon } from "./BaseLogo";
import type { ExplosionPhase } from "./GameBoard";

interface TileProps {
  index:           number;
  cols:            number;
  state:           TileState;
  adjacentCount?:  number;
  onClick:         (index: number) => void;
  disabled:         boolean;
  isCashout?:      boolean;  // pulse hint: player can cash out
  isWaitingVRF?:   boolean;  // VRF wait: bounce overlay on board; no per-tile wave
  isHighlighted?:  boolean;  // blue glow when VRF bounce logo lands on this tile
  isGameOver?:     boolean;  // fade unrevealed tiles to dark on loss
  isWinReveal?:    boolean;  // flip unrevealed tiles to white on win
  explosionPhase?: ExplosionPhase;  // mine explosion sequence: pending | exploding | exploded
}

// Classic minesweeper number colors — tuned for light (white) tile background
const NUMBER_COLORS = [
  "",                 // 0 — blank
  "text-blue-600",    // 1
  "text-green-700",   // 2
  "text-red-500",     // 3
  "text-indigo-800",  // 4
  "text-red-800",     // 5
  "text-teal-600",    // 6
  "text-gray-900",    // 7
  "text-gray-500",    // 8
];

export function Tile({
  index,
  cols,
  state,
  adjacentCount,
  onClick,
  disabled,
  isCashout       = false,
  isWaitingVRF    = false,
  isHighlighted   = false,
  isGameOver      = false,
  isWinReveal     = false,
  explosionPhase,
}: TileProps) {
  const handleClick = () => {
    if (!disabled && state === "unrevealed") {
      onClick(index);
    }
  };

  const col = index % cols;
  const row = Math.floor(index / cols);

  // Win / game-over reveals stagger left-to-right, top-to-bottom.
  const revealDelay = `${col * 55 + row * 35}ms`;

  // Game-over unrevealed tiles start fading after the mine flash peaks (~200 ms).
  const fadeDelay = `${200 + col * 18 + row * 12}ms`;

  // ── Explosion sequence (mines in staggered order) ─────────────────────────
  if (explosionPhase !== undefined) {
    if (explosionPhase === "pending") {
      return (
        <div
          className="rounded-[3px] w-full aspect-square bg-base-blue border border-blue-400/25 opacity-60 cursor-default"
          aria-hidden
        />
      );
    }
    if (explosionPhase === "exploding") {
      return (
        <div style={{ perspective: "600px" }}>
          <div
            className="
              relative flex items-center justify-center
              rounded-[3px] w-full aspect-square
              animate-tile-explode cursor-default
              border border-red-300/50 shadow-tile-mine
            "
          >
            <BaseMineIcon size={24} className="opacity-90" />
          </div>
        </div>
      );
    }
    // exploded
    return (
      <div style={{ perspective: "600px" }}>
        <div
          className="
            relative flex items-center justify-center
            rounded-[3px] w-full aspect-square
            bg-[#dd2c00] shadow-tile-mine cursor-default
            border border-red-300/30
          "
        >
          <BaseMineIcon size={24} />
        </div>
      </div>
    );
  }

  // ── Mine (single reveal, no explosion sequence) ───────────────────────────
  if (state === "mine") {
    return (
      <div style={{ perspective: "600px" }}>
        <div
          className="
            relative flex items-center justify-center
            rounded-[3px] w-full aspect-square
            bg-mine shadow-tile-mine
            animate-mine-reveal cursor-default
            border border-red-300/30
          "
        >
          <BaseMineIcon size={24} />
        </div>
      </div>
    );
  }

  // ── Safe (revealed) ──────────────────────────────────────────────────────
  if (state === "safe") {
    const n = adjacentCount ?? 0;
    return (
      <div style={{ perspective: "600px" }}>
        <div
          className="
            relative flex items-center justify-center
            rounded-[3px] w-full aspect-square
            bg-neutral-100 border border-neutral-300/60
            shadow-tile-safe cursor-default
            animate-tile-flip
          "
        >
          {n > 0 && (
            <span className={`text-xs font-bold font-mono select-none ${NUMBER_COLORS[n]}`}>
              {n}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Pending (first-flip in flight) ───────────────────────────────────────
  if (state === "pending") {
    return (
      <div
        className="
          relative flex items-center justify-center
          rounded-[3px] w-full aspect-square
          bg-blue-700/60 border border-base-blue/50
          cursor-wait
        "
      >
        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Unrevealed — win wave (flip all to white) ────────────────────────────
  if (isWinReveal) {
    return (
      <div style={{ perspective: "600px" }}>
        <div
          className="rounded-[3px] w-full aspect-square bg-base-blue animate-win-tile"
          style={{ animationDelay: revealDelay }}
        />
      </div>
    );
  }

  // ── Unrevealed — game-over fade ───────────────────────────────────────────
  if (isGameOver) {
    return (
      <div
        className="rounded-[3px] w-full aspect-square bg-base-blue animate-game-over-fade"
        style={{ animationDelay: fadeDelay }}
      />
    );
  }

  // ── Unrevealed — interactive ──────────────────────────────────────────────
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`
        relative flex items-center justify-center
        rounded-[3px] w-full aspect-square
        border border-blue-400/25
        shadow-tile
        ${disabled
          ? `cursor-not-allowed bg-base-blue ${isWaitingVRF ? "" : "opacity-60"}`
          : "cursor-pointer bg-base-blue hover:bg-blue-500 active:scale-95 hover:shadow-cashout transition-colors duration-150"
        }
        ${isCashout && !disabled && !isWaitingVRF ? "animate-pulse-slow" : ""}
        ${isHighlighted ? "shadow-tile-glow ring-2 ring-base-blue/40" : ""}
      `}
      aria-label={`Tile ${index}`}
    />
  );
}
