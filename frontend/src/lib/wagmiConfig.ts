import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo";

export const wagmiConfig = getDefaultConfig({
  appName:     "Base Minesweeper",
  projectId:   WC_PROJECT_ID,
  chains:      [baseSepolia, base],
  ssr:         false,
});
