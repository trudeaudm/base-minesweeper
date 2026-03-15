import { memo, useEffect, useState, useRef } from "react";
import { DIFF_INFO } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

interface GameOverProps {
  gridSize:   number;
  difficulty: number;
  onPlayAgain: () => void;
}

const RUGGED_LETTERS = ["R", "U", "G", "G", "E", "D"] as const;

const EXPLODE_STAGGER_MS = 120;
const EXPLODE_DURATION_MS = 400;
const EXPLODE_BASE_DELAY_MS = 520; // after entrance + impact shake

/** Stagger delay (ms) for each letter to start exploding — at least 120ms between letters. */
function getLetterExplodeDelay(index: number): number {
  return EXPLODE_BASE_DELAY_MS + index * EXPLODE_STAGGER_MS;
}

/** Deterministic particle offsets for a letter index (spread 1.5x, gravity bias). */
function getParticleOffsets(letterIndex: number, count: number): { dx: number; dy: number; scale: number }[] {
  const out: { dx: number; dy: number; scale: number }[] = [];
  const spread = 90; // 50% more than ~60; particles travel further
  const gravityBias = 38;
  for (let i = 0; i < count; i++) {
    const seed = (letterIndex * 7919 + i * 1103515245 + 12345) & 0x7fffffff;
    const angle = (seed / 0x7fffffff) * Math.PI * 2;
    const dist = (seed % 1000) / 1000 * spread + spread * 0.4;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist + gravityBias; // arc downward
    const scale = 0.7 + (seed % 300) / 300 * 0.8; // 0.7–1.5
    out.push({ dx, dy, scale });
  }
  return out;
}

const PARTICLE_COUNT_PER_LETTER = 32;
const PARTICLE_SIZE_PX = 5;

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

  // After overlay is visible, trigger each letter to explode with 120ms stagger, 400ms duration each
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
      }, delay + EXPLODE_DURATION_MS);
      timeoutsRef.current.push(endId);
    });
    const cleanupId = setTimeout(() => {
      setAnimationComplete(true);
    }, lastDelay + EXPLODE_DURATION_MS + 50);
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
        fixed inset-0 z-40 pointer-events-none flex flex-col items-center justify-center animate-rugged-impact-shake
        transition-opacity duration-500
        ${show ? "opacity-100" : "opacity-0"}
      `}
      style={{ background: "transparent" }}
      aria-hidden
    >
      {/* RUGGED: slams in then each letter explodes with stagger; particles per letter */}
      <div className="flex justify-center overflow-visible">
        <h1
          className="inline-flex text-6xl sm:text-7xl font-black tracking-tighter text-white animate-rugged-slide-in drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          style={{ fontFamily: "Coinbase Sans, Inter, sans-serif", textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
        >
          {RUGGED_LETTERS.map((letter, i) => {
            const particles = getParticleOffsets(i, PARTICLE_COUNT_PER_LETTER);
            const isExploding = explodingLetters.has(i);
            return (
              <span
                key={i}
                className="inline-block relative"
                style={{ minWidth: "0.5em", textAlign: "center" }}
              >
                {/* Letter (fades/scales out when exploding) */}
                <span
                  className={`
                    inline-block
                    ${explodedLetters.has(i) ? "invisible" : ""}
                    ${isExploding ? "animate-rugged-letter-explode" : ""}
                  `}
                >
                  {letter}
                </span>
                {/* Pixel particles when this letter explodes */}
                {isExploding && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
                    {particles.map((p, j) => (
                      <span
                        key={j}
                        className="absolute rounded-sm bg-white/90 animate-rugged-particle"
                        style={{
                          width: PARTICLE_SIZE_PX,
                          height: PARTICLE_SIZE_PX,
                          left: "50%",
                          top: "50%",
                          marginLeft: -PARTICLE_SIZE_PX / 2,
                          marginTop: -PARTICLE_SIZE_PX / 2,
                          ["--dx" as string]: `${p.dx}px`,
                          ["--dy" as string]: `${p.dy}px`,
                          ["--scale" as string]: p.scale,
                        }}
                      />
                    ))}
                  </span>
                )}
              </span>
            );
          })}
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
