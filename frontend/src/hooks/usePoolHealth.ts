import { useReadContract } from "wagmi";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import { CONTRACT_ADDRESS, CHAIN_ID, GRID_SMALL, GRID_MEDIUM, GRID_LARGE, DIFF_EASY, DIFF_NORMAL, DIFF_HARD } from "@/lib/config";

export function usePoolHealth() {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "getPoolHealth",
    chainId: CHAIN_ID,
    query:   { refetchInterval: 15_000, enabled: true },
  });

  return {
    pool:            data?.[0] ?? 0n,
    reserved:        data?.[1] ?? 0n,
    fees:            data?.[2] ?? 0n,
    contractBalance: data?.[3] ?? 0n,
    isLoading,
    refetch,
  };
}

export function useGridAvailability() {
  const grids  = [GRID_SMALL, GRID_MEDIUM, GRID_LARGE];
  const diffs  = [DIFF_EASY, DIFF_NORMAL, DIFF_HARD];

  // Batch availability checks
  const results: Record<number, Record<number, boolean>> = {};

  for (const g of grids) {
    results[g] = {};
    for (const d of diffs) {
      // We use individual hooks via useReadContract
      // In a real app you'd use multicall; this is simplified
      results[g][d] = true; // placeholder — see useGridAvailabilityForCell
    }
  }

  return results;
}

export function useGridAvailable(gridSize: number, difficulty: number) {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "isGridAvailable",
    args:    [gridSize, difficulty],
    chainId: CHAIN_ID,
    query:   { refetchInterval: 15_000, enabled: true },
  });
  return data ?? false;
}

/** Min pool balance required per grid (from contract gridConfigs). Used for tooltip. */
export function useMinPoolThresholds(): Record<number, bigint> {
  const small  = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args:    [GRID_SMALL],
    chainId: CHAIN_ID,
    query:   { refetchInterval: 15_000, enabled: true },
  });
  const medium = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args:    [GRID_MEDIUM],
    chainId: CHAIN_ID,
    query:   { refetchInterval: 15_000, enabled: true },
  });
  const large  = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "gridConfigs",
    args:    [GRID_LARGE],
    chainId: CHAIN_ID,
    query:   { refetchInterval: 15_000, enabled: true },
  });
  // gridConfigs returns (totalTiles, entryFee, maxPayoutBPS, maxConcurrent, minPoolThreshold, active)
  return {
    [GRID_SMALL]:  (small.data as readonly unknown[])?.[4] as bigint ?? 0n,
    [GRID_MEDIUM]: (medium.data as readonly unknown[])?.[4] as bigint ?? 0n,
    [GRID_LARGE]:  (large.data as readonly unknown[])?.[4] as bigint ?? 0n,
  };
}
