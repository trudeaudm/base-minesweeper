import { useEffect, useState } from "react";
import { BaseMineIcon } from "./BaseLogo";
import { formatEth, GRID_INFO, DIFF_INFO } from "@/lib/config";

interface GameOverProps {
  entryFee:   bigint;
  gridSize:   number;
  difficulty: number;
  onPlayAgain: () => void;
}

export function GameOverScreen({ entryFee, gridSize, difficulty, onPlayAgain }: GameOverProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Delay the overlay so the mine-reveal flash and safe-tile fade animations
    // are visible on the board before it's covered (~400 ms).
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, []);

  const info     = GRID_INFO[gridSize as 0 | 1 | 2];
  const diffInfo = DIFF_INFO[difficulty as 0 | 1 | 2];

  return (
    <div
      className={`
        fixed inset-0 z-50 flex flex-col items-center justify-center
        bg-black/95 backdrop-blur-sm
        transition-opacity duration-500
        ${show ? "opacity-100" : "opacity-0"}
      `}
    >
      {/* Exploded icon */}
      <div className="animate-bounce-in mb-6">
        <div className="w-24 h-24 bg-mine rounded-[12px] flex items-center justify-center shadow-tile-mine">
          <BaseMineIcon size={56} />
        </div>
      </div>

      <h1 className="text-4xl font-bold text-white mb-2">Boom!</h1>
      <p className="text-white/50 text-sm mb-8">
        {info.label} · <span className={diffInfo.color}>{diffInfo.label}</span>
      </p>

      <div className="text-center mb-8">
        <div className="text-white/40 text-xs uppercase tracking-widest mb-1">You lost</div>
        <div className="text-3xl font-mono font-bold text-mine">
          {formatEth(entryFee, 4)} ETH
        </div>
        <p className="text-white/30 text-sm mt-2">Hit a mine — better luck next time</p>
      </div>

      <button
        onClick={onPlayAgain}
        className="
          px-10 py-4 bg-base-blue text-white
          rounded-[6px] font-bold text-lg
          hover:bg-blue-500 active:scale-95
          transition-all duration-200 shadow-xl
        "
      >
        Try Again
      </button>
    </div>
  );
}
