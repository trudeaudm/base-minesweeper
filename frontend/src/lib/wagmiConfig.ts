import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";
import { http } from "wagmi";
import { fallback } from "viem";
import { getRpcUrlForChain } from "@/lib/config";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo";
const CHAIN_ID      = Number(import.meta.env.VITE_CHAIN_ID || "84532");

const BASE_SEPOLIA_PUBLIC = "https://sepolia.base.org";
const BASE_MAINNET_PUBLIC = "https://mainnet.base.org";

const customSepolia = getRpcUrlForChain(84532);
const customMainnet = getRpcUrlForChain(8453);

// Use custom RPC when not the public default; add public as fallback so invalid/rate-limited RPCs retry.
const sepoliaTransport =
  customSepolia !== BASE_SEPOLIA_PUBLIC
    ? fallback([http(customSepolia), http(BASE_SEPOLIA_PUBLIC)])
    : http(BASE_SEPOLIA_PUBLIC);

const mainnetTransport =
  customMainnet !== BASE_MAINNET_PUBLIC
    ? fallback([http(customMainnet), http(BASE_MAINNET_PUBLIC)])
    : http(BASE_MAINNET_PUBLIC);

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
