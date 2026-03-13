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
        "pulse-slow":  "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "mine-reveal": "mineReveal 0.4s ease-out forwards",
        "win-flash":   "winFlash 0.6s ease-out forwards",
        "tile-flip":   "tileFlip 0.3s ease-out forwards",
        "bounce-in":   "bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
      },
      keyframes: {
        mineReveal: {
          "0%":   { transform: "scale(1)",    backgroundColor: "#0052FF" },
          "50%":  { transform: "scale(1.15)", backgroundColor: "#FF4444" },
          "100%": { transform: "scale(1)",    backgroundColor: "#FF4444" },
        },
        winFlash: {
          "0%":   { opacity: "0", backgroundColor: "#0052FF" },
          "50%":  { opacity: "1", backgroundColor: "#00C851" },
          "100%": { opacity: "1", backgroundColor: "#0052FF" },
        },
        tileFlip: {
          "0%":   { transform: "rotateY(90deg)", opacity: "0" },
          "100%": { transform: "rotateY(0deg)",  opacity: "1" },
        },
        bounceIn: {
          "0%":   { transform: "scale(0.3)",   opacity: "0" },
          "50%":  { transform: "scale(1.05)",  opacity: "0.8" },
          "70%":  { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)",     opacity: "1" },
        },
      },
      boxShadow: {
        "tile":      "0 2px 8px rgba(0,82,255,0.4)",
        "tile-safe": "0 2px 8px rgba(0,200,81,0.3)",
        "tile-mine": "0 2px 8px rgba(255,68,68,0.6)",
        "cashout":   "0 0 20px rgba(0,82,255,0.6)",
      },
    },
  },
  plugins: [],
};
