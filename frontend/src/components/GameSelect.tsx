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
  getMaxPayoutWei,
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
  available,
  maxPayoutLabel,
}: {
  gridSize:       number;
  difficulty:     number;
  selected:       boolean;
  onSelect:       () => void;
  available:      boolean;
  maxPayoutLabel: string;
}) {
  const info   = GRID_INFO[gridSize as 0 | 1 | 2];
  const mines  = MINE_COUNTS[gridSize as 0|1|2][difficulty as 0|1|2];
  const maxMulti = difficulty === 0 ? "1.5×" : difficulty === 1 ? "1.7×" : "1.9×";

  return (
    <button
      onClick={onSelect}
      disabled={!available}
      className={`
        relative w-full p-4 rounded-[6px] border-2 text-left transition-all duration-200
        ${selected
          ? "border-base-blue bg-base-blue/15 shadow-cashout"
          : available
          ? "border-gray-200 bg-gray-50 hover:border-base-blue/50 hover:bg-gray-100"
          : "border-gray-100 bg-gray-50/50 opacity-40 cursor-not-allowed"
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[#111111] font-bold text-lg">{info.label}</div>
          <div className="text-gray-500 text-xs mt-0.5">
            {info.totalTiles} tiles · {mines} mines
          </div>
        </div>
        <div className="text-right">
          <div className="text-[#111111] font-mono font-semibold">{info.entryLabel}</div>
          <div className="text-gray-500 text-xs font-mono">max {maxMulti}</div>
        </div>
      </div>
      {!available && (
        <div className="mt-2 text-xs text-gray-500">
          Pool insufficient · needs {maxPayoutLabel} ETH to activate
        </div>
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

  const availableSmall  = useGridAvailable(GRID_SMALL, selectedDiff);
  const availableMedium = useGridAvailable(GRID_MEDIUM, selectedDiff);
  const availableLarge  = useGridAvailable(GRID_LARGE, selectedDiff);

  const available = useGridAvailable(selectedGrid, selectedDiff);

  const poolStatus =
    !availableSmall && !availableMedium && !availableLarge
      ? "none"
      : availableSmall && availableMedium && availableLarge
      ? "all"
      : "some";

  const poolDotClass =
    poolStatus === "none"
      ? "bg-mine"
      : poolStatus === "some"
      ? "bg-yellow-500"
      : "bg-accent-green animate-pulse";

  return (
    <div className="w-full max-w-sm mx-auto space-y-6">
      {/* Pool health */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500 uppercase tracking-widest">Pool balance</span>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${poolDotClass}`} />
          <span className="font-mono text-sm text-gray-700">
            {formatEth(poolBalance, 4)} ETH
          </span>
        </div>
      </div>

      {/* Grid selection */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Select grid</div>
        <div className="space-y-2">
          {GRIDS.map(g => (
            <GridOption
              key={g}
              gridSize={g}
              difficulty={selectedDiff}
              selected={selectedGrid === g}
              onSelect={() => setSelectedGrid(g)}
              available={g === GRID_SMALL ? availableSmall : g === GRID_MEDIUM ? availableMedium : availableLarge}
              maxPayoutLabel={formatEth(getMaxPayoutWei(g, selectedDiff), 4)}
            />
          ))}
        </div>
        {poolStatus === "none" && (
          <p className="mt-3 text-sm text-gray-600 text-center">
            The prize pool is currently being refilled. Check back soon!
          </p>
        )}
      </div>

      {/* Difficulty selection */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Difficulty</div>
        <div className="grid grid-cols-3 gap-2">
          {DIFFS.map(d => {
            const info = DIFF_INFO[d];
            const sel  = selectedDiff === d;
            return (
              <button
                key={d}
                onClick={() => setSelectedDiff(d)}
                className={`
                  py-2.5 rounded-[4px] font-medium text-sm transition-all
                  ${sel
                    ? "bg-base-blue text-white border-2 border-base-blue"
                    : "bg-gray-50 text-gray-600 border-2 border-gray-200 hover:border-gray-300"
                  }
                `}
              >
                {info.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500 text-center">
          Easy 1.5× · Normal 1.7× · Hard 1.9× max payout
        </p>
      </div>

      {/* Start button */}
      <button
        onClick={() => onStart(selectedGrid, selectedDiff)}
        disabled={!available || isStarting}
        className={`
          w-full py-4 rounded-[6px] font-bold text-lg transition-all duration-200
          ${available && !isStarting
            ? "bg-base-blue hover:bg-blue-500 text-white shadow-cashout active:scale-95"
            : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }
        `}
      >
        {isStarting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-base-blue border-t-transparent rounded-full animate-spin" />
            Starting game…
          </span>
        ) : !available ? (
          "Grid Unavailable"
        ) : (
          `Play for ${GRID_INFO[selectedGrid as 0|1|2].entryLabel}`
        )}
      </button>

      <p className="text-center text-xs text-gray-500">
        5% platform fee · Chainlink VRF fairness · Base Sepolia
      </p>
    </div>
  );
}
