import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";
import { http } from "wagmi";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo";
const CHAIN_ID      = Number(import.meta.env.VITE_CHAIN_ID || "84532");
const CUSTOM_RPC    = import.meta.env.VITE_RPC_URL as string | undefined;

// Use VITE_RPC_URL for the active chain so wagmi contract reads go through a
// non-rate-limited endpoint.  The inactive chain still gets the public fallback.
const sepoliaTransport = (CHAIN_ID === 84532 && CUSTOM_RPC)
  ? http(CUSTOM_RPC)
  : http("https://sepolia.base.org");

const mainnetTransport = (CHAIN_ID === 8453 && CUSTOM_RPC)
  ? http(CUSTOM_RPC)
  : http("https://mainnet.base.org");

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
