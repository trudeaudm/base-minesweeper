import { baseSepolia, base } from "wagmi/chains";
import type { Chain } from "viem";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "84532");

export const SUPPORTED_CHAIN: Chain =
  CHAIN_ID === 8453 ? base : baseSepolia;

const ALCHEMY_KEY = (import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined)?.trim();
const rawRpc = import.meta.env.VITE_RPC_URL as string | undefined;
const fullRpc = rawRpc?.trim()
  ? (/^https?:\/\//i.test(rawRpc.trim()) ? rawRpc.trim() : `https://${rawRpc.trim()}`)
  : null;

/** Resolved RPC URL for the given chain: Alchemy key → built URL, else full VITE_RPC_URL for active chain, else public. */
export function getRpcUrlForChain(chainId: number): string {
  if (ALCHEMY_KEY) {
    return chainId === 8453
      ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
      : `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  }
  if (fullRpc && chainId === CHAIN_ID) return fullRpc;
  return chainId === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org";
}

/** Public RPC used by session-key wallet clients (no wallet provider involved). */
export const RPC_URL: string = getRpcUrlForChain(CHAIN_ID);

/** Session key gas budget (must match Minesweeper.SESSION_GAS_BUDGET). Sent with startGame and forwarded to session key. */
export const SESSION_GAS_BUDGET = BigInt("100000000000000"); // 0.0001 ETH

// Grid sizes
export const GRID_SMALL  = 0;
export const GRID_MEDIUM = 1;
export const GRID_LARGE  = 2;

// Difficulties
export const DIFF_EASY   = 0;
export const DIFF_NORMAL = 1;
export const DIFF_HARD   = 2;

// Grid metadata
export const GRID_INFO = {
  [GRID_SMALL]: {
    label:      "5×4",
    rows:       4,
    cols:       5,
    totalTiles: 20,
    entryFee:   BigInt("1000000000000000"),  // 0.001 ETH
    entryLabel: "0.001 ETH",
  },
  [GRID_MEDIUM]: {
    label:      "5×6",
    rows:       6,
    cols:       5,
    totalTiles: 30,
    entryFee:   BigInt("5000000000000000"),  // 0.005 ETH
    entryLabel: "0.005 ETH",
  },
  [GRID_LARGE]: {
    label:      "5×10",
    rows:       10,
    cols:       5,
    totalTiles: 50,
    entryFee:   BigInt("10000000000000000"), // 0.01 ETH
    entryLabel: "0.01 ETH",
  },
} as const;

export const DIFF_INFO = {
  [DIFF_EASY]:   { label: "Easy",   color: "text-accent-green" },
  [DIFF_NORMAL]: { label: "Normal", color: "text-base-blue"    },
  [DIFF_HARD]:   { label: "Hard",   color: "text-mine"         },
} as const;

export const MINE_COUNTS = {
  [GRID_SMALL]:  { [DIFF_EASY]: 4, [DIFF_NORMAL]: 5, [DIFF_HARD]: 6  },
  [GRID_MEDIUM]: { [DIFF_EASY]: 5, [DIFF_NORMAL]: 7, [DIFF_HARD]: 10 },
  [GRID_LARGE]:  { [DIFF_EASY]: 8, [DIFF_NORMAL]: 11,[DIFF_HARD]: 15 },
} as const;

// Game status enum — must match GameStatus in Minesweeper.sol exactly
export enum GameStatus {
  WAITING_FIRST_FLIP = 0, // startGame done; player clicks a tile to trigger VRF
  WAITING_VRF        = 1, // VRF request in-flight; mines not yet placed
  ACTIVE             = 2, // mines placed; player can flip tiles
  CASHED_OUT         = 3,
  GAME_OVER          = 4,
  CANCELLED          = 5,
}

// Max payout BPS by difficulty (1.5×, 1.7×, 1.9×)
export const MAX_PAYOUT_BPS_EASY   = 15000n; // 1.5×
export const MAX_PAYOUT_BPS_NORMAL = 17000n; // 1.7×
export const MAX_PAYOUT_BPS_HARD   = 19000n; // 1.9×
export const BPS_DENOMINATOR       = 10000n;

/** Max payout in wei for a grid + difficulty (matches contract logic for isGridAvailable). */
export function getMaxPayoutWei(gridSize: number, difficulty: number): bigint {
  const cfg = GRID_INFO[gridSize as 0 | 1 | 2];
  const bps = difficulty === DIFF_EASY ? MAX_PAYOUT_BPS_EASY
    : difficulty === DIFF_NORMAL ? MAX_PAYOUT_BPS_NORMAL : MAX_PAYOUT_BPS_HARD;
  return (cfg.entryFee * bps) / BPS_DENOMINATOR;
}

// Block-based cancellation thresholds (must match Minesweeper.sol)
export const CANCEL_BLOCKS_WAITING_FIRST_FLIP = 100;   // ~3.3 min on Base
export const CANCEL_BLOCKS_WAITING_VRF        = 43200; // ~24h on Base

/** Calculate payout multiplier for display (0 → 0, full → 1.5× / 1.7× / 1.9× by difficulty). */
export function calcMultiplier(
  safeRevealed: number,
  totalSafe:    number,
  difficulty:   number // 0 Easy, 1 Normal, 2 Hard
): number {
  if (totalSafe === 0 || safeRevealed === 0) return 0;
  const maxMult = difficulty === 0 ? 1.5 : difficulty === 1 ? 1.7 : 1.9;
  return (safeRevealed / totalSafe) * maxMult;
}

/** Format ETH value from bigint wei to human-readable string */
export function formatEth(wei: bigint, decimals = 4): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(decimals);
}
