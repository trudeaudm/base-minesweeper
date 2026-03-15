import { useState, useEffect, useRef } from "react";
import { GRID_LAYOUT } from "@/lib/config";

const BASE_BLUE = "#0052FF";
const BRAND_COLORS = [
  "#0052FF", // Base blue (used for idle; excluded when picking random)
  "#6699FF",
  "#E8EAF0",
  "#B0B7C3",
  "#C4A882",
  "#FFD166",
  "#000000",
  "#06D6A0",
  "#B7FF6B",
  "#FF4D00",
  "#FFB3C6",
];

const FLY_OUT_DURATION_MS = 550;
const FLY_IN_DURATION_MS = 550;
const FLY_TOTAL_MS = FLY_OUT_DURATION_MS + FLY_IN_DURATION_MS;
/* Idle ≈ 2× fly so ~1/3 of tiles are animating at any time */
const IDLE_MIN_MS = 1000;
const IDLE_MAX_MS = 1300;

type TileFlyDirection = "left" | "right" | "up" | "down";
const DIRECTIONS: TileFlyDirection[] = ["left", "right", "up", "down"];

function pickRandomColor(): string {
  const withoutBase = BRAND_COLORS.filter((c) => c !== BASE_BLUE);
  return withoutBase[Math.floor(Math.random() * withoutBase.length)];
}

function pickRandomDirection(): TileFlyDirection {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

type TilePhase = "idle" | "out" | "in";

type TileState = {
  phase: TilePhase;
  color: string;
  direction: TileFlyDirection;
};

/** Decorative grid of tiles with fly-off-and-back animation for the VRF loading screen. */
export function LoadingTileGrid({ gridSize }: { gridSize: 0 | 1 | 2 }) {
  const layout = GRID_LAYOUT[gridSize];
  const totalTiles = layout.rows * layout.cols;

  const [tiles, setTiles] = useState<TileState[]>(() =>
    Array.from({ length: totalTiles }, () => ({
      phase: "idle" as TilePhase,
      color: BASE_BLUE,
      direction: "left" as TileFlyDirection,
    }))
  );

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const startFly = (index: number) => {
      setTiles((prev) => {
        const next = [...prev];
        next[index] = {
          phase: "out",
          color: pickRandomColor(),
          direction: pickRandomDirection(),
        };
        return next;
      });

      const t1 = setTimeout(() => {
        setTiles((prev) => {
          const next = [...prev];
          if (next[index].phase === "out") next[index] = { ...next[index], phase: "in" };
          return next;
        });

        const t2 = setTimeout(() => {
          setTiles((prev) => {
            const next = [...prev];
            next[index] = {
              phase: "idle",
              color: BASE_BLUE,
              direction: prev[index].direction,
            };
            return next;
          });
          const idleMs = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
          const t3 = setTimeout(() => startFly(index), idleMs);
          timersRef.current.push(t3);
        }, FLY_IN_DURATION_MS);
        timersRef.current.push(t2);
      }, FLY_OUT_DURATION_MS);
      timersRef.current.push(t1);
    };

    const cycleMs = FLY_TOTAL_MS + (IDLE_MIN_MS + IDLE_MAX_MS) / 2;
    for (let i = 0; i < totalTiles; i++) {
      const stagger = (i / totalTiles) * cycleMs;
      const t = setTimeout(() => startFly(i), stagger);
      timersRef.current.push(t);
    }

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [totalTiles]);

  return (
    <>
      <style>{`
        @keyframes loadingFlyOutLeft {
          from { transform: translate(0, 0); }
          to   { transform: translate(-150%, 0); }
        }
        @keyframes loadingFlyOutRight {
          from { transform: translate(0, 0); }
          to   { transform: translate(150%, 0); }
        }
        @keyframes loadingFlyOutUp {
          from { transform: translate(0, 0); }
          to   { transform: translate(0, -150%); }
        }
        @keyframes loadingFlyOutDown {
          from { transform: translate(0, 0); }
          to   { transform: translate(0, 150%); }
        }
        @keyframes loadingFlyInLeft {
          from { transform: translate(150%, 0); }
          to   { transform: translate(0, 0); }
        }
        @keyframes loadingFlyInRight {
          from { transform: translate(-150%, 0); }
          to   { transform: translate(0, 0); }
        }
        @keyframes loadingFlyInUp {
          from { transform: translate(0, 150%); }
          to   { transform: translate(0, 0); }
        }
        @keyframes loadingFlyInDown {
          from { transform: translate(0, -150%); }
          to   { transform: translate(0, 0); }
        }
      `}</style>
      <div
        className="grid gap-1.5 w-full max-w-xs mx-auto pointer-events-none"
        style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}
        role="presentation"
        aria-hidden
      >
        {tiles.map((tile, i) => {
          const isOut = tile.phase === "out";
          const isIn = tile.phase === "in";
          const d = tile.direction;
          const outName =
            d === "left"
              ? "loadingFlyOutLeft"
              : d === "right"
                ? "loadingFlyOutRight"
                : d === "up"
                  ? "loadingFlyOutUp"
                  : "loadingFlyOutDown";
          const inName =
            d === "left"
              ? "loadingFlyInLeft"
              : d === "right"
                ? "loadingFlyInRight"
                : d === "up"
                  ? "loadingFlyInUp"
                  : "loadingFlyInDown";
          return (
            <div
              key={i}
              className="rounded-[3px] w-full aspect-square border border-blue-400/25 opacity-90"
              style={{
                backgroundColor: tile.color,
                ...(isOut && {
                  animation: `${outName} ${FLY_OUT_DURATION_MS}ms cubic-bezier(0.42, 0, 1, 1) forwards`,
                }),
                ...(isIn && {
                  animation: `${inName} ${FLY_IN_DURATION_MS}ms cubic-bezier(0, 0, 0.58, 1) forwards`,
                }),
              }}
            />
          );
        })}
      </div>
    </>
  );
}
