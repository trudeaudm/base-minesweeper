import type { RefObject } from "react";
import { type TileState } from "@/hooks/useGame";
import { BaseMineIcon } from "./BaseLogo";
import type { ExplosionPhase, TileFlyDirection } from "./GameBoard";

interface TileProps {
  index:               number;
  cols:                number;
  state:               TileState;
  pendingIndicesRef?:  RefObject<number[] | undefined>;  // ref updated at click so pending shows immediately (BUG 1)
  adjacentCount?:      number;
  onClick:             (index: number) => void;
  disabled:            boolean;
  isCashout?:          boolean;  // pulse hint: player can cash out
  isWaitingVRF?:       boolean;  // VRF wait: grey + fly animation (use with flyDirection)
  flyDirection?:       TileFlyDirection;  // when isWaitingVRF: direction for fly-off-and-back
  isHighlighted?:      boolean;  // blue glow when VRF bounce logo lands on this tile
  isGameOver?:         boolean;  // fade unrevealed tiles to dark on loss
  isWinReveal?:        boolean;  // flip unrevealed tiles to white on win
  explosionPhase?:     ExplosionPhase;  // mine explosion sequence: pending | exploding | exploded
  isShaking?:          boolean;  // subtle shake (random tiles during play)
  burstOrderIndex?:    number | null;  // index in burst reveal order (0-based), null if not in burst
  currentBurstIndex?:  number;  // current step in burst sequence
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
  pendingIndicesRef,
  adjacentCount,
  onClick,
  disabled,
  isCashout       = false,
  isWaitingVRF    = false,
  flyDirection,
  isHighlighted   = false,
  isGameOver      = false,
  isWinReveal     = false,
  explosionPhase,
  isShaking       = false,
  burstOrderIndex = null,
  currentBurstIndex = 0,
}: TileProps) {
  const inBurstList = burstOrderIndex !== null && burstOrderIndex !== undefined;
  const inPendingRef = pendingIndicesRef?.current?.includes(index);
  const showAsPending = state === "pending" || (inBurstList && currentBurstIndex < burstOrderIndex) || (inPendingRef && state === "unrevealed");
  const showBurstReveal = inBurstList && currentBurstIndex === burstOrderIndex;
  const showRevealedAfterBurst = inBurstList && currentBurstIndex > burstOrderIndex;
  const flyClass =
    flyDirection === "left"
      ? "animate-tile-fly-left"
      : flyDirection === "right"
        ? "animate-tile-fly-right"
        : flyDirection === "up"
          ? "animate-tile-fly-up"
          : flyDirection === "down"
            ? "animate-tile-fly-down"
            : "";
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled && state === "unrevealed") {
      const el = e.currentTarget;
      el.classList.add("tile-pending-anim");
      el.setAttribute("data-tile-pending", "true");
      if (process.env.NODE_ENV === "development") console.log("[tile] pending class applied", index);
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

  // ── Waiting for VRF: grey tile, fly off-and-back (direction from parent)
  if (isWaitingVRF && flyDirection && state === "unrevealed") {
    return (
      <div
        className={`
          rounded-[3px] w-full aspect-square
          bg-gray-400 border border-gray-500/50 opacity-80 cursor-not-allowed
          ${flyClass}
        `}
        aria-hidden
      />
    );
  }

  /* BUG 3: No separate pending div — same button gets .tile-pending-anim in handleClick and when showAsPending so animation is visible within one frame */

  // ── Mine (single reveal, or burst reveal with puff then reveal)
  if (state === "mine") {
    if (showBurstReveal) {
      return (
        <div style={{ perspective: "600px" }} className="relative w-full aspect-square">
          <div
            className="absolute inset-0 rounded-[3px] bg-base-blue border border-blue-400/25 animate-tile-puff"
            aria-hidden
          />
          <div
            className="relative flex items-center justify-center w-full h-full rounded-[3px] bg-mine shadow-tile-mine border border-red-300/30 opacity-0 animate-reveal-after-puff"
          >
            <BaseMineIcon size={24} />
          </div>
        </div>
      );
    }
    return (
      <div style={{ perspective: "600px" }}>
        <div
          className="
            relative flex items-center justify-center
            rounded-[3px] w-full aspect-square
            bg-mine shadow-tile-mine cursor-default
            border border-red-300/30
            animate-mine-reveal
          "
        >
          <BaseMineIcon size={24} />
        </div>
      </div>
    );
  }

  // ── Safe (revealed, or burst reveal with puff then reveal)
  if (state === "safe") {
    const n = adjacentCount ?? 0;
    if (showBurstReveal) {
      return (
        <div style={{ perspective: "600px" }} className="relative w-full aspect-square">
          <div
            className="absolute inset-0 rounded-[3px] bg-base-blue border border-blue-400/25 animate-tile-puff"
            aria-hidden
          />
          <div
            className="relative flex items-center justify-center w-full h-full rounded-[3px] bg-neutral-100 border border-neutral-300/60 shadow-tile-safe opacity-0 animate-reveal-after-puff"
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

  // ── Unrevealed (and pending) — single button; BUG 3: class applied in handleClick + when showAsPending
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
          ? "cursor-not-allowed bg-base-blue opacity-60"
          : "cursor-pointer bg-base-blue hover:bg-blue-500 active:scale-95 hover:shadow-cashout transition-colors duration-150"
        }
        ${showAsPending ? "tile-pending-anim cursor-wait" : ""}
        ${isShaking ? "animate-tile-shake" : ""}
        ${isHighlighted ? "shadow-tile-glow ring-2 ring-base-blue/40" : ""}
      `}
      data-tile-pending={showAsPending ? true : undefined}
      aria-label={`Tile ${index}`}
    />
  );
}
