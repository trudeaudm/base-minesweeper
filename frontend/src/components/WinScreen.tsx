import { useEffect, useState } from "react";
import { BaseLogo } from "./BaseLogo";
import { formatEth, GRID_INFO, DIFF_INFO } from "@/lib/config";

interface WinScreenProps {
  payout:    bigint;
  entryFee:  bigint;
  gridSize:  number;
  difficulty:number;
  onPlayAgain: () => void;
}

export function WinScreen({ payout, entryFee, gridSize, difficulty, onPlayAgain }: WinScreenProps) {
  const [show, setShow] = useState(false);
  const multiplier = entryFee > 0n ? Number(payout * 10000n / entryFee) / 10000 : 0;

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(t);
  }, []);

  const info     = GRID_INFO[gridSize as 0 | 1 | 2];
  const diffInfo = DIFF_INFO[difficulty as 0 | 1 | 2];

  return (
    <div
      className={`
        fixed inset-0 z-50 flex flex-col items-center justify-center
        bg-base-blue/95 backdrop-blur-sm
        transition-opacity duration-500
        ${show ? "opacity-100" : "opacity-0"}
      `}
    >
      {/* Animated logo */}
      <div className="animate-bounce-in mb-6">
        <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-2xl">
          <BaseLogo size={56} className="opacity-90" />
        </div>
      </div>

      <h1 className="text-4xl font-bold text-white mb-2 animate-bounce-in">
        You Won!
      </h1>
      <p className="text-white/70 text-sm mb-8">
        {info.label} · <span className={diffInfo.color}>{diffInfo.label}</span>
      </p>

      {/* Payout */}
      <div className="text-center mb-8 animate-bounce-in">
        <div className="text-white/60 text-xs uppercase tracking-widest mb-1">Payout</div>
        <div className="text-5xl font-mono font-bold text-white">
          {formatEth(payout, 5)}
        </div>
        <div className="text-white/80 text-xl font-mono mt-1">ETH</div>
        <div className="mt-3 inline-block px-4 py-1.5 bg-white/20 rounded-full">
          <span className="text-white font-bold font-mono">{multiplier.toFixed(2)}×</span>
          <span className="text-white/60 text-sm ml-1">your entry</span>
        </div>
      </div>

      <button
        onClick={onPlayAgain}
        className="
          px-10 py-4 bg-white text-base-blue
          rounded-xl font-bold text-lg
          hover:bg-white/90 active:scale-95
          transition-all duration-200 shadow-xl
        "
      >
        Play Again
      </button>
    </div>
  );
}
