/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          blue:  "#0052FF",
          black: "#000000",
          white: "#FFFFFF",
        },
        mine:   "#FF4444",
        win:    "#00C851",
        accent: {
          yellow: "#FFD700",
          green:  "#00C851",
          pink:   "#FF69B4",
          blue:   "#0052FF",
        },
      },
      fontFamily: {
        sans:  ["Coinbase Sans", "Inter", "sans-serif"],
        mono:  ["Coinbase Mono", "JetBrains Mono", "monospace"],
      },
      animation: {
        "pulse-slow":      "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "mine-reveal":     "mineReveal 0.55s ease-out forwards",
        "win-flash":       "winFlash 0.6s ease-out forwards",
        "tile-flip":       "tileFlip 0.32s ease-out forwards",
        "bounce-in":       "bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        "vrf-wave":        "vrfWave 1.8s ease-in-out infinite",
        "win-tile":        "winTile 0.4s ease-out forwards",
        "game-over-fade":  "gameOverFade 0.45s ease-out forwards",
        "cashout-glow":    "cashoutGlow 2s ease-in-out infinite",
        "vrf-bar-spin":    "vrfBarSpin 0.4s linear infinite",
        "tile-explode":    "tileExplode 0.25s ease-out forwards",
        "screen-shake":    "screenShake 0.3s ease-out forwards",
        "tile-shake":      "tileShake 0.35s ease-in-out",
      },
      keyframes: {
        vrfBarSpin: {
          "0%":   { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        // ── Tile flip: new element starts visually blue (matching unrevealed),
        //    folds to edge at 40%, unfolds as light/white at 60 %.
        tileFlip: {
          "0%":   { transform: "rotateY(0deg)",  backgroundColor: "#0052FF" },
          "40%":  { transform: "rotateY(90deg)", backgroundColor: "#0052FF" },
          "60%":  { transform: "rotateY(0deg)",  backgroundColor: "#f5f5f5" },
          "100%": { transform: "rotateY(0deg)",  backgroundColor: "#f5f5f5" },
        },
        // ── Mine reveal: flip in + scale pop + shake
        mineReveal: {
          "0%":   { transform: "rotateY(0deg)  scale(1)    translateX(0px)",  backgroundColor: "#0052FF" },
          "20%":  { transform: "rotateY(90deg) scale(1)    translateX(0px)",  backgroundColor: "#0052FF" },
          "35%":  { transform: "rotateY(0deg)  scale(1.22) translateX(0px)",  backgroundColor: "#FF4444" },
          "50%":  { transform: "rotateY(0deg)  scale(1.15) translateX(-5px)", backgroundColor: "#FF4444" },
          "62%":  { transform: "rotateY(0deg)  scale(1.15) translateX(5px)",  backgroundColor: "#FF4444" },
          "74%":  { transform: "rotateY(0deg)  scale(1.08) translateX(-3px)", backgroundColor: "#FF4444" },
          "86%":  { transform: "rotateY(0deg)  scale(1.08) translateX(3px)",  backgroundColor: "#FF4444" },
          "100%": { transform: "rotateY(0deg)  scale(1)    translateX(0px)",  backgroundColor: "#FF4444" },
        },
        winFlash: {
          "0%":   { opacity: "0", backgroundColor: "#0052FF" },
          "50%":  { opacity: "1", backgroundColor: "#00C851" },
          "100%": { opacity: "1", backgroundColor: "#0052FF" },
        },
        bounceIn: {
          "0%":   { transform: "scale(0.3)",  opacity: "0" },
          "50%":  { transform: "scale(1.05)", opacity: "0.8" },
          "70%":  { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)",    opacity: "1" },
        },
        // ── VRF waiting: gentle left-to-right brightness wave (delay set inline per tile)
        vrfWave: {
          "0%, 100%": {
            transform:       "scale(1)",
            backgroundColor: "#0052FF",
            boxShadow:       "0 2px 8px rgba(0,82,255,0.4)",
          },
          "50%": {
            transform:       "scale(1.05)",
            backgroundColor: "#3d7aff",
            boxShadow:       "0 0 18px rgba(0,82,255,0.9), 0 0 6px rgba(61,122,255,0.5)",
          },
        },
        // ── Win tile wave: unrevealed tile flips from blue → white
        winTile: {
          "0%":   { transform: "rotateY(0deg)",  backgroundColor: "#0052FF" },
          "40%":  { transform: "rotateY(90deg)", backgroundColor: "#0052FF" },
          "60%":  { transform: "rotateY(0deg)",  backgroundColor: "#ffffff" },
          "100%": { transform: "rotateY(0deg)",  backgroundColor: "#ffffff" },
        },
        // ── Game-over: unrevealed tiles fade to dark (mine reveals handled by mineReveal)
        gameOverFade: {
          "0%":   { backgroundColor: "#0052FF", opacity: "1" },
          "100%": { backgroundColor: "#1c1c1c", opacity: "0.35" },
        },
        // ── Cashout button glow pulse (speed + intensity controlled inline)
        cashoutGlow: {
          "0%, 100%": { boxShadow: "0 0 10px rgba(0,82,255,0.45)" },
          "50%":      { boxShadow: "0 0 28px rgba(0,82,255,0.85), 0 0 54px rgba(0,82,255,0.3)" },
        },
        // ── Mine explosion: flash white, scale pulse, settle red/orange
        tileExplode: {
          "0%":   { backgroundColor: "#ffffff", transform: "scale(1)" },
          "25%":  { backgroundColor: "#ffffff", transform: "scale(1.3)" },
          "100%": { backgroundColor: "#dd2c00", transform: "scale(1)" },
        },
        screenShake: {
          "0%, 100%":  { transform: "translate(0, 0)" },
          "15%":       { transform: "translate(-4px, 2px)" },
          "30%":       { transform: "translate(4px, -2px)" },
          "45%":       { transform: "translate(-3px, 1px)" },
          "60%":       { transform: "translate(3px, -1px)" },
          "75%":       { transform: "translate(-2px, 0)" },
        },
        // ── Subtle per-tile shake (random tiles during play)
        tileShake: {
          "0%, 100%":   { transform: "translate(0, 0)" },
          "25%":       { transform: "translate(-1px, 0.5px)" },
          "50%":       { transform: "translate(1px, -0.5px)" },
          "75%":       { transform: "translate(-0.5px, 0)" },
        },
      },
      boxShadow: {
        "tile":      "0 2px 8px rgba(0,82,255,0.35)",
        "tile-safe": "0 1px 4px rgba(0,0,0,0.12)",
        "tile-mine": "0 2px 8px rgba(255,68,68,0.5)",
        "cashout":   "0 0 20px rgba(0,82,255,0.5)",
        "tile-glow": "0 0 14px rgba(0,82,255,0.7), 0 0 6px rgba(0,82,255,0.4)",
      },
    },
  },
  plugins: [],
};
