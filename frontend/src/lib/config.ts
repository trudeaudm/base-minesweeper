import { baseSepolia, base } from "wagmi/chains";
import type { Chain } from "viem";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || "84532");

export const SUPPORTED_CHAIN: Chain =
  CHAIN_ID === 8453 ? base : baseSepolia;

/** Public RPC used by session-key wallet clients (no wallet provider involved). */
export const RPC_URL: string =
  import.meta.env.VITE_RPC_URL ||
  (CHAIN_ID === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org");

/**
 * URL of the gas relayer service (POST /fund).
 * When set, tile flips and cashouts are submitted by the ephemeral session key
 * (no wallet popup). When unset the app falls back to the connected wallet.
 */
export const RELAYER_URL: string | null =
  import.meta.env.VITE_RELAYER_URL || null;

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
    label:      "5×7",
    rows:       7,
    cols:       5,
    totalTiles: 35,
    entryFee:   BigInt("5000000000000000"),  // 0.005 ETH
    entryLabel: "0.005 ETH",
  },
  [GRID_LARGE]: {
    label:      "5×11",
    rows:       11,
    cols:       5,
    totalTiles: 55,
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
  [GRID_SMALL]:  { [DIFF_EASY]: 3, [DIFF_NORMAL]: 4, [DIFF_HARD]: 6  },
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

// Max payout BPS
export const MAX_PAYOUT_BPS_NORMAL = 19000n; // 1.90×
export const MAX_PAYOUT_BPS_HARD   = 19500n; // 1.95×
export const BPS_DENOMINATOR       = 10000n;

// Block-based cancellation thresholds (must match Minesweeper.sol)
export const CANCEL_BLOCKS_WAITING_FIRST_FLIP = 100;   // ~3.3 min on Base
export const CANCEL_BLOCKS_WAITING_VRF        = 43200; // ~24h on Base

/** Calculate payout multiplier string for display (0 → "0.00×", full → "1.90×") */
export function calcMultiplier(
  safeRevealed: number,
  totalSafe:    number,
  isHard:       boolean
): number {
  if (totalSafe === 0 || safeRevealed === 0) return 0;
  const maxBps = isHard ? 1.95 : 1.9;
  return (safeRevealed / totalSafe) * maxBps;
}

/** Format ETH value from bigint wei to human-readable string */
export function formatEth(wei: bigint, decimals = 4): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(decimals);
}
