import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";
import { http } from "wagmi";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo";

// Use public RPC only for chain traffic. Wagmi/viem poll block number and run background
// requests constantly; sending those to Alchemy causes 429 (Too Many Requests). Public RPC
// is free and avoids rate limits. For explicit txs (e.g. session wallet), config.getRpcUrlForChain
// can still return Alchemy when VITE_ALCHEMY_API_KEY is set.
const BASE_SEPOLIA_PUBLIC = "https://sepolia.base.org";
const BASE_MAINNET_PUBLIC = "https://mainnet.base.org";

const sepoliaTransport = http(BASE_SEPOLIA_PUBLIC);
const mainnetTransport = http(BASE_MAINNET_PUBLIC);

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
