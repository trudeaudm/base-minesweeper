import { GRID_LAYOUT } from "@/lib/config";

type TileFlyDirection = "left" | "right" | "up" | "down";

function getFlyDirection(index: number): TileFlyDirection {
  const dirs: TileFlyDirection[] = ["left", "right", "up", "down"];
  const seed = (index * 1103515245 + 12345) & 0x7fffffff;
  return dirs[seed % 4];
}

/** Decorative grid of tiles with fly-off-and-back animation for the VRF loading screen. */
export function LoadingTileGrid({ gridSize }: { gridSize: 0 | 1 | 2 }) {
  const layout = GRID_LAYOUT[gridSize];
  const totalTiles = layout.rows * layout.cols;

  return (
    <div
      className="grid gap-1.5 w-full max-w-xs mx-auto"
      style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}
      role="presentation"
      aria-hidden
    >
      {Array.from({ length: totalTiles }, (_, i) => {
        const dir = getFlyDirection(i);
        const flyClass =
          dir === "left"
            ? "animate-tile-fly-left"
            : dir === "right"
              ? "animate-tile-fly-right"
              : dir === "up"
                ? "animate-tile-fly-up"
                : "animate-tile-fly-down";
        return (
          <div
            key={i}
            className={`
              rounded-[3px] w-full aspect-square
              bg-gray-400 border border-gray-500/50 opacity-80
              ${flyClass}
            `}
          />
        );
      })}
    </div>
  );
}
