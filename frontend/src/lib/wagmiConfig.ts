import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";
import { http } from "wagmi";
import { getRpcUrlForChain } from "@/lib/config";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo";

// Use VITE_RPC_URL when set (required in browser — public RPC returns 403 for browser requests).
// When unset, falls back to public RPC (may 403 in production). Prefer a provider that allows
// browser traffic (Alchemy, QuickNode, Infura, etc.) to avoid 403 and control rate limits.
const sepoliaTransport = http(getRpcUrlForChain(baseSepolia.id));
const mainnetTransport = http(getRpcUrlForChain(base.id));

export const wagmiConfig = getDefaultConfig({
  appName:    "Base Minesweeper",
  projectId:  WC_PROJECT_ID,
  chains:     [baseSepolia, base],
  transports: {
    [baseSepolia.id]: sepoliaTransport,
    [base.id]:        mainnetTransport,
  },
  ssr: false,
});
