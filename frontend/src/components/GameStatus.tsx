import { formatEth, GameStatus, DIFF_INFO } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

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
  // Block-based cancel: only before first flip (100 blocks)
  cancelBlockDataReady: boolean;
  blocksUntilCancel:   number;
  canCancel:           boolean;
  cancelThresholdBlocks: number;
  onCancelGame:       () => void;
  isCancelling:       boolean;
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
  cancelBlockDataReady,
  blocksUntilCancel,
  canCancel,
  cancelThresholdBlocks,
  onCancelGame,
  isCancelling,
}: GameStatusProps) {
  const { gridInfo } = useGridConfigs();
  const info       = gridInfo?.[gridSize as 0 | 1 | 2];
  const diffInfo   = DIFF_INFO[difficulty as 0 | 1 | 2];
  const isActive   = status === GameStatus.ACTIVE;
  const canCashout = isActive && safeRevealed > 0;
  const showCancelUI = isWaitingFirstFlip && cancelBlockDataReady;
  const gridLabel = info?.label ?? "…";

  const progressPct = totalSafe > 0 ? (safeRevealed / totalSafe) * 100 : 0;
  const multiplierColor =
    multiplier >= 1.5
      ? "text-accent-green"
      : multiplier >= 1.0
      ? "text-accent-yellow"
      : "text-[#111111]";

  return (
    <div className="w-full max-w-xs mx-auto space-y-3">
      {/* Grid info row */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span className="font-mono">
          {gridLabel} &nbsp;·&nbsp;
          <span className={diffInfo.color}>{diffInfo.label}</span>
        </span>
        <span className="font-mono">
          Entry: <span className="text-[#111111]">{formatEth(entryFee, 4)} ETH</span>
          <span className="text-gray-500"> + 0.0001 ETH gas</span>
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{safeRevealed} / {totalSafe} safe tiles</span>
          <span>{progressPct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-base-blue rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Multiplier display */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-widest">Multiplier</div>
          <div className={`text-3xl font-bold font-mono ${multiplierColor} transition-colors`}>
            {multiplier > 0 ? `${multiplier.toFixed(2)}×` : "0.00×"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 uppercase tracking-widest">Current win</div>
          <div className="text-xl font-mono font-semibold text-[#111111]">
            {formatEth(currentPayout, 5)} ETH
          </div>
          <div className="text-xs text-gray-500 font-mono">
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

      {/* Waiting for VRF after first click — animation is on the board */}
      {isWaitingVRF && (
        <div className="text-center py-3 space-y-2">
          <div className="inline-flex items-center gap-2 text-base-blue text-sm">
            <div className="w-4 h-4 border-2 border-base-blue border-t-transparent rounded-full animate-spin" />
            Generating mine layout…
          </div>
          <p className="text-xs text-gray-500">
            Waiting for Chainlink VRF randomness
          </p>
        </div>
      )}

      {/* Cancel only before first flip: 100-block countdown or button */}
      {showCancelUI && (
        <div className="space-y-2">
          {blocksUntilCancel > 0 ? (
            <p className="text-xs text-gray-500 text-center">
              Cancel available in <span className="font-mono text-gray-700">{blocksUntilCancel}</span> blocks
            </p>
          ) : canCancel ? (
            <button
              onClick={onCancelGame}
              disabled={isCancelling}
              className={`
                w-full py-3 rounded-[6px] font-bold text-sm transition-all duration-200
                ${!isCancelling
                  ? "bg-yellow-600 hover:bg-yellow-500 text-white active:scale-95"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }
              `}
            >
              {isCancelling ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-base-blue border-t-transparent rounded-full animate-spin" />
                  Cancelling…
                </span>
              ) : (
                "Cancel Game & Refund"
              )}
            </button>
          ) : null}
        </div>
      )}

      {/* Cash Out button — pulse speed + glow intensity scale with multiplier */}
      {isActive && !isWaitingVRF && (
        <button
          onClick={onCashOut}
          disabled={!canCashout || isCashingOut}
          className={`
            w-full py-3.5 rounded-[6px] font-bold text-lg transition-colors duration-200
            ${canCashout && !isCashingOut
              ? "bg-base-blue hover:bg-blue-500 text-white animate-cashout-glow active:scale-95"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }
          `}
          style={canCashout && !isCashingOut ? {
            // Faster pulse + stronger glow as multiplier climbs
            animationDuration: `${Math.max(0.55, 2.2 - (multiplier - 1.0) * 2.2).toFixed(2)}s`,
            boxShadow: `0 0 ${Math.round(Math.min(52, 12 + (multiplier - 1.0) * 44))}px rgba(0,82,255,${Math.min(0.9, 0.38 + (multiplier - 1.0) * 0.55).toFixed(2)})`,
          } : undefined}
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
