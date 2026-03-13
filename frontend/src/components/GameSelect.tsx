import { useState } from "react";
import { useGridAvailable } from "@/hooks/usePoolHealth";
import {
  GRID_INFO,
  DIFF_INFO,
  MINE_COUNTS,
  GRID_SMALL,
  GRID_MEDIUM,
  GRID_LARGE,
  DIFF_EASY,
  DIFF_NORMAL,
  DIFF_HARD,
  formatEth,
} from "@/lib/config";

interface GameSelectProps {
  onStart:    (gridSize: number, difficulty: number) => void;
  isStarting: boolean;
  poolBalance: bigint;
}

const GRIDS = [GRID_SMALL, GRID_MEDIUM, GRID_LARGE] as const;
const DIFFS = [DIFF_EASY, DIFF_NORMAL, DIFF_HARD]   as const;

function GridOption({
  gridSize,
  difficulty,
  selected,
  onSelect,
}: {
  gridSize:   number;
  difficulty: number;
  selected:   boolean;
  onSelect:   () => void;
}) {
  const available = useGridAvailable(gridSize, difficulty);
  const info      = GRID_INFO[gridSize as 0 | 1 | 2];
  const mines     = MINE_COUNTS[gridSize as 0|1|2][difficulty as 0|1|2];
  const maxMulti  = difficulty === 2 ? "1.95×" : "1.90×";

  return (
    <button
      onClick={onSelect}
      disabled={!available}
      className={`
        relative w-full p-4 rounded-xl border-2 text-left transition-all duration-200
        ${selected
          ? "border-base-blue bg-base-blue/20 shadow-cashout"
          : available
          ? "border-white/10 bg-white/5 hover:border-base-blue/50 hover:bg-white/10"
          : "border-white/5 bg-white/2 opacity-40 cursor-not-allowed"
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-white font-bold text-lg">{info.label}</div>
          <div className="text-white/50 text-xs mt-0.5">
            {info.totalTiles} tiles · {mines} mines
          </div>
        </div>
        <div className="text-right">
          <div className="text-white font-mono font-semibold">{info.entryLabel}</div>
          <div className="text-white/40 text-xs font-mono">max {maxMulti}</div>
        </div>
      </div>
      {!available && (
        <div className="mt-2 text-xs text-white/40 italic">Temporarily Unavailable</div>
      )}
      {selected && available && (
        <div className="absolute top-2 right-2 w-2 h-2 bg-base-blue rounded-full" />
      )}
    </button>
  );
}

export function GameSelect({ onStart, isStarting, poolBalance }: GameSelectProps) {
  const [selectedGrid, setSelectedGrid] = useState<number>(GRID_SMALL);
  const [selectedDiff, setSelectedDiff] = useState<number>(DIFF_NORMAL);

  const available = useGridAvailable(selectedGrid, selectedDiff);

  return (
    <div className="w-full max-w-sm mx-auto space-y-6">
      {/* Pool health */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-white/40 uppercase tracking-widest">Pool balance</span>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${poolBalance > 0n ? "bg-accent-green animate-pulse" : "bg-mine"}`} />
          <span className="font-mono text-sm text-white/70">
            {formatEth(poolBalance, 4)} ETH
          </span>
        </div>
      </div>

      {/* Grid selection */}
      <div>
        <div className="text-xs text-white/40 uppercase tracking-widest mb-3">Select grid</div>
        <div className="space-y-2">
          {GRIDS.map(g => (
            <GridOption
              key={g}
              gridSize={g}
              difficulty={selectedDiff}
              selected={selectedGrid === g}
              onSelect={() => setSelectedGrid(g)}
            />
          ))}
        </div>
      </div>

      {/* Difficulty selection */}
      <div>
        <div className="text-xs text-white/40 uppercase tracking-widest mb-3">Difficulty</div>
        <div className="grid grid-cols-3 gap-2">
          {DIFFS.map(d => {
            const info = DIFF_INFO[d];
            const sel  = selectedDiff === d;
            return (
              <button
                key={d}
                onClick={() => setSelectedDiff(d)}
                className={`
                  py-2.5 rounded-lg font-medium text-sm transition-all
                  ${sel
                    ? "bg-base-blue text-white border-2 border-base-blue"
                    : "bg-white/5 text-white/60 border-2 border-white/10 hover:border-white/30"
                  }
                `}
              >
                {info.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-white/30 text-center">
          {selectedDiff === DIFF_HARD
            ? "Hard mode pays up to 1.95× entry"
            : "Easy / Normal pay up to 1.90× entry"
          }
        </p>
      </div>

      {/* Start button */}
      <button
        onClick={() => onStart(selectedGrid, selectedDiff)}
        disabled={!available || isStarting}
        className={`
          w-full py-4 rounded-xl font-bold text-lg transition-all duration-200
          ${available && !isStarting
            ? "bg-base-blue hover:bg-blue-500 text-white shadow-cashout active:scale-95"
            : "bg-white/10 text-white/30 cursor-not-allowed"
          }
        `}
      >
        {isStarting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Starting game…
          </span>
        ) : !available ? (
          "Grid Unavailable"
        ) : (
          `Play for ${GRID_INFO[selectedGrid as 0|1|2].entryLabel}`
        )}
      </button>

      <p className="text-center text-xs text-white/30">
        5% platform fee · Chainlink VRF fairness · Base Sepolia
      </p>
    </div>
  );
}
