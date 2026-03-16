import { formatEth, GameStatus, DIFF_INFO } from "@/lib/config";

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
  const diffInfo   = DIFF_INFO[difficulty as 0 | 1 | 2];
  const isActive   = status === GameStatus.ACTIVE;
  const canCashout = isActive && safeRevealed > 0;
  const showCancelUI = isWaitingVRF && cancelBlockDataReady;

  const multiplierColor =
    multiplier >= 1.5
      ? "text-accent-green"
      : multiplier >= 1.0
      ? "text-accent-yellow"
      : "text-[#111111]";

  return (
    <div className="w-full max-w-xs mx-auto space-y-3">
      {/* Multiplier and current win — labels small/muted, values dominant */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Multiplier</div>
          <div className={`text-3xl font-bold font-mono ${multiplierColor} transition-colors`}>
            {multiplier > 0 ? `${multiplier.toFixed(2)}×` : "0.00×"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Current win</div>
          <div className="text-xl font-mono font-semibold text-[#111111]">
            {formatEth(currentPayout, 5)} ETH
          </div>
          <div className="text-[10px] text-gray-400 font-mono">
            max {formatEth(maxPayout, 5)} ETH
          </div>
        </div>
      </div>

      {/* Shown only when status is WAITING_VRF (loading screen); board not visible yet */}
      {isWaitingVRF && (
        <div className="text-center py-3 space-y-2">
          <div className="inline-flex items-center gap-2 text-base-blue text-sm">
            <div className="w-4 h-4 border-2 border-base-blue border-t-transparent rounded-full animate-spin" />
            Generating provably fair randomness…
          </div>
          <p className="text-xs text-gray-500">
            Waiting for Chainlink VRF
          </p>
        </div>
      )}

      {/* Cancel when stuck in WAITING_VRF: 100-block countdown or button */}
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
