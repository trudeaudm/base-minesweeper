import { formatEth, GameStatus, GRID_INFO, DIFF_INFO } from "@/lib/config";

interface GameStatusProps {
  gridSize:           number;
  difficulty:         number;
  entryFee:           bigint;
  maxPayout:          bigint;
  currentPayout:      bigint;
  multiplier:         number;
  safeRevealed:       number;
  totalSafe:          number;
  status:             GameStatus;
  onCashOut:          () => void;
  isCashingOut:       boolean;
  isWaitingFirstFlip: boolean;
  isWaitingVRF:       boolean;
}

export function GameStatusBar({
  gridSize,
  difficulty,
  entryFee,
  maxPayout,
  currentPayout,
  multiplier,
  safeRevealed,
  totalSafe,
  status,
  onCashOut,
  isCashingOut,
  isWaitingFirstFlip,
  isWaitingVRF,
}: GameStatusProps) {
  const info       = GRID_INFO[gridSize as 0 | 1 | 2];
  const diffInfo   = DIFF_INFO[difficulty as 0 | 1 | 2];
  const isActive   = status === GameStatus.ACTIVE;
  const canCashout = isActive && safeRevealed > 0;

  const progressPct = totalSafe > 0 ? (safeRevealed / totalSafe) * 100 : 0;
  const multiplierColor =
    multiplier >= 1.5
      ? "text-accent-green"
      : multiplier >= 1.0
      ? "text-accent-yellow"
      : "text-white";

  return (
    <div className="w-full max-w-xs mx-auto space-y-3">
      {/* Grid info row */}
      <div className="flex items-center justify-between text-xs text-white/60">
        <span className="font-mono">
          {info.label} &nbsp;·&nbsp;
          <span className={diffInfo.color}>{diffInfo.label}</span>
        </span>
        <span className="font-mono">
          Entry: <span className="text-white">{formatEth(entryFee, 4)} ETH</span>
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>{safeRevealed} / {totalSafe} safe tiles</span>
          <span>{progressPct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-base-blue rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Multiplier display */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-white/50 uppercase tracking-widest">Multiplier</div>
          <div className={`text-3xl font-bold font-mono ${multiplierColor} transition-colors`}>
            {multiplier > 0 ? `${multiplier.toFixed(2)}×` : "0.00×"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/50 uppercase tracking-widest">Current win</div>
          <div className="text-xl font-mono font-semibold text-white">
            {formatEth(currentPayout, 5)} ETH
          </div>
          <div className="text-xs text-white/40 font-mono">
            max {formatEth(maxPayout, 5)} ETH
          </div>
        </div>
      </div>

      {/* Prompt: click any tile to start */}
      {isWaitingFirstFlip && (
        <div className="text-center py-3">
          <div className="inline-flex items-center gap-2 text-accent-green text-sm font-medium">
            <div className="w-2 h-2 bg-accent-green rounded-full animate-pulse" />
            Click any tile to begin — your first click is always safe!
          </div>
        </div>
      )}

      {/* Waiting for VRF after first click */}
      {isWaitingVRF && (
        <div className="text-center py-3">
          <div className="inline-flex items-center gap-2 text-base-blue text-sm">
            <div className="w-4 h-4 border-2 border-base-blue border-t-transparent rounded-full animate-spin" />
            Generating mine layout…
          </div>
          <p className="text-xs text-white/40 mt-1">
            Waiting for Chainlink VRF randomness
          </p>
        </div>
      )}

      {/* Cash Out button */}
      {isActive && !isWaitingVRF && (
        <button
          onClick={onCashOut}
          disabled={!canCashout || isCashingOut}
          className={`
            w-full py-3.5 rounded-xl font-bold text-lg transition-all duration-200
            ${canCashout && !isCashingOut
              ? "bg-base-blue hover:bg-blue-500 text-white shadow-cashout animate-pulse-slow active:scale-95"
              : "bg-white/10 text-white/30 cursor-not-allowed"
            }
          `}
        >
          {isCashingOut ? (
            <span className="inline-flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Cashing out…
            </span>
          ) : canCashout ? (
            `Cash Out — ${formatEth(currentPayout, 5)} ETH`
          ) : (
            "Reveal a tile to enable cashout"
          )}
        </button>
      )}
    </div>
  );
}
