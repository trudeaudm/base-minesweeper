import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import {
  CONTRACT_ADDRESS,
  CHAIN_ID,
  GRID_LAYOUT,
  GRID_SMALL,
  GRID_MEDIUM,
  GRID_LARGE,
  formatEth,
  type GridInfo,
} from "@/lib/config";

/** Contract gridConfigs returns [totalTiles, entryFee, maxPayoutBPS, maxConcurrent, minPoolThreshold, active]. */
const GRID_CONFIG_INDEX = {
  totalTiles: 0,
  entryFee: 1,
  maxPayoutBPS: 2,
  maxConcurrent: 3,
  minPoolThreshold: 4,
  active: 5,
} as const;

/**
 * Fetches grid config (entry fee, totalTiles, active) from the contract once on load.
 * Merges with static GRID_LAYOUT (label, rows, cols) so consumers get the same shape as before.
 * Refetches only when chain/contract changes (no polling).
 */
export function useGridConfigs(): {
  gridInfo: GridInfo | null;
  isLoading: boolean;
  error: Error | null;
} {
  const small = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args: [GRID_SMALL],
    chainId: CHAIN_ID,
    query: { refetchInterval: false, staleTime: Number.POSITIVE_INFINITY },
  });
  const medium = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args: [GRID_MEDIUM],
    chainId: CHAIN_ID,
    query: { refetchInterval: false, staleTime: Number.POSITIVE_INFINITY },
  });
  const large = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args: [GRID_LARGE],
    chainId: CHAIN_ID,
    query: { refetchInterval: false, staleTime: Number.POSITIVE_INFINITY },
  });

  const isLoading = small.isLoading || medium.isLoading || large.isLoading;
  const error = small.error ?? medium.error ?? large.error ?? null;

  const gridInfo = useMemo((): GridInfo | null => {
    const d0 = small.data as readonly unknown[] | undefined;
    const d1 = medium.data as readonly unknown[] | undefined;
    const d2 = large.data as readonly unknown[] | undefined;
    if (!d0 || !d1 || !d2) return null;

    const build = (gridSize: 0 | 1 | 2, raw: readonly unknown[]) => {
      const entryFee = raw[GRID_CONFIG_INDEX.entryFee] as bigint;
      return {
        ...GRID_LAYOUT[gridSize],
        totalTiles: Number(raw[GRID_CONFIG_INDEX.totalTiles]),
        entryFee,
        entryLabel: formatEth(entryFee, 4),
        active: Boolean(raw[GRID_CONFIG_INDEX.active]),
      };
    };

    return {
      [GRID_SMALL]: build(GRID_SMALL, d0),
      [GRID_MEDIUM]: build(GRID_MEDIUM, d1),
      [GRID_LARGE]: build(GRID_LARGE, d2),
    };
  }, [small.data, medium.data, large.data]);

  return { gridInfo, isLoading, error: error ?? null };
}
