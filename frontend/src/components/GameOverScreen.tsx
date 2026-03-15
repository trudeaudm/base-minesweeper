import { useEffect, useState, useRef } from "react";
import { BaseMineIcon } from "./BaseLogo";
import { formatEth, GRID_INFO, DIFF_INFO } from "@/lib/config";

interface GameOverProps {
  entryFee:   bigint;
  gridSize:   number;
  difficulty: number;
  onPlayAgain: () => void;
}

const RUGGED_LETTERS = ["R", "U", "G", "G", "E", "D"] as const;

/** Random stagger delay (ms) for each letter explode — slight offset so not simultaneous. */
function getLetterExplodeDelay(index: number): number {
  const base = 600; // after slide-in settles
  const perLetter = 120 + (index * 37) % 80;
  const jitter = (index * 1103515245 + 12345) & 0xff;
  return base + index * perLetter + (jitter % 90);
}

export function GameOverScreen({ entryFee, gridSize, difficulty, onPlayAgain }: GameOverProps) {
  const [show, setShow] = useState(false);
  const [explodingLetters, setExplodingLetters] = useState<Set<number>>(new Set());
  const [explodedLetters, setExplodedLetters] = useState<Set<number>>(new Set());
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, []);

  // After overlay is visible, trigger each letter to explode with random stagger
  useEffect(() => {
    if (!show) return;
    RUGGED_LETTERS.forEach((_, i) => {
      const delay = getLetterExplodeDelay(i);
      const startId = setTimeout(() => {
        setExplodingLetters((prev) => new Set(prev).add(i));
      }, delay);
      timeoutsRef.current.push(startId);
      const endId = setTimeout(() => {
        setExplodingLetters((prev) => {
          const next = new Set(prev);
          next.delete(i);
          return next;
        });
        setExplodedLetters((prev) => new Set(prev).add(i));
      }, delay + 400);
      timeoutsRef.current.push(endId);
    });
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [show]);

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
      {/* RUGGED: flies in then each letter explodes with stagger */}
      <div className="mb-8 flex justify-center overflow-visible">
        <h1
          className="inline-flex text-6xl sm:text-7xl font-black tracking-tighter text-white animate-rugged-slide-in"
          style={{ fontFamily: "Coinbase Sans, Inter, sans-serif" }}
          aria-hidden
        >
          {RUGGED_LETTERS.map((letter, i) => (
            <span
              key={i}
              className={`
                inline-block
                ${explodedLetters.has(i) ? "invisible" : ""}
                ${explodingLetters.has(i) ? "animate-rugged-letter-explode" : ""}
              `}
              style={{ minWidth: "0.5em", textAlign: "center" }}
            >
              {letter}
            </span>
          ))}
        </h1>
      </div>

      {/* Exploded icon */}
      <div className="animate-bounce-in mb-6">
        <div className="w-24 h-24 bg-mine rounded-[12px] flex items-center justify-center shadow-tile-mine">
          <BaseMineIcon size={56} />
        </div>
      </div>

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
