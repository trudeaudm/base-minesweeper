import { memo, useEffect, useState, useRef } from "react";
import { DIFF_INFO } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

interface GameOverProps {
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

function GameOverScreenComponent({ gridSize, difficulty, onPlayAgain }: GameOverProps) {
  const [show, setShow] = useState(false);
  const [explodingLetters, setExplodingLetters] = useState<Set<number>>(new Set());
  const [explodedLetters, setExplodedLetters] = useState<Set<number>>(new Set());
  const [animationComplete, setAnimationComplete] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { gridInfo } = useGridConfigs();

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, []);

  // After overlay is visible, trigger each letter to explode with random stagger
  useEffect(() => {
    if (!show) return;
    const lastIndex = RUGGED_LETTERS.length - 1;
    const lastDelay = getLetterExplodeDelay(lastIndex);
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
    // When last letter has finished exploding, mark complete and remove overlay from DOM (BUG 3: no leftover label)
    const cleanupId = setTimeout(() => {
      setAnimationComplete(true);
    }, lastDelay + 400 + 50);
    timeoutsRef.current.push(cleanupId);
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [show]);

  if (animationComplete) return null;

  const info     = gridInfo?.[gridSize as 0 | 1 | 2];
  const diffInfo = DIFF_INFO[difficulty as 0 | 1 | 2];
  const gridLabel = info?.label ?? "…";

  // Overlay only: transparent background, RUGGED text and letter explosion. Board remains visible; no Try Again (use New Game below grid).
  return (
    <div
      className={`
        fixed inset-0 z-40 pointer-events-none flex flex-col items-center justify-center
        transition-opacity duration-500
        ${show ? "opacity-100" : "opacity-0"}
      `}
      style={{ background: "transparent" }}
      aria-hidden
    >
      {/* RUGGED: flies in then each letter explodes with stagger */}
      <div className="flex justify-center overflow-visible">
        <h1
          className="inline-flex text-6xl sm:text-7xl font-black tracking-tighter text-white animate-rugged-slide-in drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          style={{ fontFamily: "Coinbase Sans, Inter, sans-serif", textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
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
      {/* Optional small label so overlay context is clear; still no background */}
      <p
        className="mt-4 text-white/80 text-sm drop-shadow-md"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
      >
        {gridLabel} · <span className={diffInfo.color}>{diffInfo.label}</span>
      </p>
      <div className="mt-8 pointer-events-auto">
        <button
          type="button"
          onClick={onPlayAgain}
          className="
            px-10 py-4 bg-white text-base-blue
            rounded-[6px] font-bold text-lg
            hover:bg-white/90 active:scale-95
            transition-all duration-200 shadow-xl
          "
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

export const GameOverScreen = memo(GameOverScreenComponent);
