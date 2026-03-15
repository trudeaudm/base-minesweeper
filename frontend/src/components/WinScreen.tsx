import { useEffect, useRef, useState } from "react";
import { BaseLogo } from "./BaseLogo";
import { formatEth, DIFF_INFO } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

// ── Confetti burst ────────────────────────────────────────────────────────────
function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      size: number;
      rotation: number; rotSpeed: number;
      color: string;
      opacity: number;
    };

    const colors = ["#0052FF", "#4d8eff", "#99bbff", "#ffffff", "#ccdaff"];
    const cx = canvas.width  / 2;
    const cy = canvas.height * 0.38;

    const particles: Particle[] = Array.from({ length: 160 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 11 + 3;
      return {
        x:        cx + (Math.random() - 0.5) * 80,
        y:        cy,
        vx:       Math.cos(angle) * speed,
        vy:       Math.sin(angle) * speed - 5,
        size:     Math.random() * 10 + 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.28,
        color:    colors[Math.floor(Math.random() * colors.length)],
        opacity:  1,
      };
    });

    const totalFrames = 200; // ~3.3 s at 60 fps
    let frame = 0;
    let animId: number;

    function render() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      particles.forEach((p) => {
        p.vy       += 0.28;          // gravity
        p.x        += p.vx;
        p.y        += p.vy;
        p.rotation += p.rotSpeed;
        if (frame > 70) p.opacity -= 1 / (totalFrames - 70);

        ctx!.save();
        ctx!.globalAlpha = Math.max(0, p.opacity);
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rotation);
        ctx!.fillStyle = p.color;
        // Draw as a flat rectangular confetti piece
        ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx!.restore();
      });
      frame++;
      if (frame < totalFrames) animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
    />
  );
}

// ── Win screen ────────────────────────────────────────────────────────────────
interface WinScreenProps {
  payout:      bigint;
  entryFee:    bigint;
  gridSize:    number;
  difficulty:  number;
  onPlayAgain: () => void;
}

export function WinScreen({ payout, entryFee, gridSize, difficulty, onPlayAgain }: WinScreenProps) {
  const [show,         setShow]         = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const multiplier = entryFee > 0n ? Number(payout * 10000n / entryFee) / 10000 : 0;

  const { gridInfo } = useGridConfigs();
  const info     = gridInfo?.[gridSize as 0 | 1 | 2];
  const diffInfo = DIFF_INFO[difficulty as 0 | 1 | 2];
  const gridLabel = info?.label ?? "…";

  useEffect(() => {
    // Delay the overlay so the win-tile wave on the board plays first (~700 ms),
    // then fire confetti as the overlay peaks in opacity.
    const t1 = setTimeout(() => setShow(true),         700);
    const t2 = setTimeout(() => setShowConfetti(true), 1050);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <>
      {showConfetti && <Confetti />}

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
          <div className="w-24 h-24 bg-base-blue rounded-[12px] flex items-center justify-center shadow-2xl">
            <BaseLogo size={56} className="opacity-95" />
          </div>
        </div>

        <h1 className="text-4xl font-bold text-white mb-2 animate-bounce-in">
          You Won!
        </h1>
        <p className="text-white/70 text-sm mb-8">
          {gridLabel} · <span className={diffInfo.color}>{diffInfo.label}</span>
        </p>

        {/* Payout */}
        <div className="text-center mb-8 animate-bounce-in">
          <div className="text-white/60 text-xs uppercase tracking-widest mb-1">Payout</div>
          <div className="text-5xl font-mono font-bold text-white">
            {formatEth(payout, 5)}
          </div>
          <div className="text-white/80 text-xl font-mono mt-1">ETH</div>
          <div className="mt-3 inline-block px-4 py-1.5 bg-white/20 rounded-[6px]">
            <span className="text-white font-bold font-mono">{multiplier.toFixed(2)}×</span>
            <span className="text-white/60 text-sm ml-1">your entry</span>
          </div>
        </div>

        <button
          onClick={onPlayAgain}
          className="
            px-10 py-4 bg-white text-base-blue
            rounded-[6px] font-bold text-lg
            hover:bg-white/90 active:scale-95
            transition-all duration-200 shadow-xl
          "
        >
          Play Again
        </button>
      </div>
    </>
  );
}
