import { useReadContract } from "wagmi";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import { CONTRACT_ADDRESS, GRID_SMALL, GRID_MEDIUM, GRID_LARGE, DIFF_EASY, DIFF_NORMAL, DIFF_HARD } from "@/lib/config";

export function usePoolHealth() {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi:     MINESWEEPER_ABI,
    functionName: "getPoolHealth",
    query: { refetchInterval: 15_000 },
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
    query:   { refetchInterval: 15_000 },
  });
  return data ?? false;
}
