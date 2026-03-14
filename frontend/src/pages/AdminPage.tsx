import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useBlockNumber, usePublicClient, useBalance } from "wagmi";
import { parseEther } from "viem";
import { Header } from "@/components/Header";
import { LandingHero } from "@/components/LandingHero";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import { CONTRACT_ADDRESS, formatEth, CANCEL_BLOCKS_WAITING_FIRST_FLIP, CANCEL_BLOCKS_WAITING_VRF } from "@/lib/config";

const GRID_LABELS: Record<number, string> = {
  0: "5×4",
  1: "5×7",
  2: "5×11",
};

const STATUS_LABELS: Record<number, string> = {
  0: "Waiting first flip",
  1: "Waiting VRF",
  2: "Active",
  3: "Cashed out",
  4: "Game over",
  5: "Cancelled",
};

interface StuckGame {
  gameId: bigint;
  player: string;
  gridSize: number;
  status: number;
  startBlock: bigint;
  blocksElapsed: number;
  requiredBlocks: number;
  eligible: boolean;
}

export function AdminPage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: currentBlock = 0n } = useBlockNumber({ watch: true });

  const { data: ownerAddress } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "owner",
  });

  const isOwner =
    isConnected &&
    connectedAddress &&
    ownerAddress &&
    String(connectedAddress).toLowerCase() === String(ownerAddress).toLowerCase();

  const { data: poolHealth, refetch: refetchPoolHealth } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "getPoolHealth",
    query: { refetchInterval: 30_000 },
  });

  const { data: safeFloor } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "safeReserveFloor",
  });

  const { data: ownerBalanceData } = useBalance({
    address: isOwner ? connectedAddress! : undefined,
    query: { refetchInterval: 30_000 },
  });
  const ownerWalletBalance = ownerBalanceData?.value ?? 0n;

  const pool = poolHealth?.[0] ?? 0n;
  const reserved = poolHealth?.[1] ?? 0n;
  const fees = poolHealth?.[2] ?? 0n;
  const contractBalance = poolHealth?.[3] ?? 0n;
  const floor = safeFloor ?? 0n;
  const maxWithdrawable = pool > floor ? pool - floor : 0n;

  const { writeContractAsync, isPending: isWritePending } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [stuckGames, setStuckGames] = useState<StuckGame[]>([]);
  const [cancellingId, setCancellingId] = useState<bigint | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  const { data: nextGameId } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MINESWEEPER_ABI,
    functionName: "nextGameId",
    query: { refetchInterval: 15_000 },
  });

  function weiToInputString(wei: bigint): string {
    const eth = Number(wei) / 1e18;
    return eth.toFixed(6);
  }

  useEffect(() => {
    if (maxWithdrawable > 0n && !withdrawAmount) {
      setWithdrawAmount(weiToInputString(maxWithdrawable));
    }
  }, [maxWithdrawable, withdrawAmount]);

  useEffect(() => {
    if (!nextGameId || nextGameId <= 1n || !publicClient) {
      setStuckGames([]);
      return;
    }
    const fromId = nextGameId > 100n ? nextGameId - 100n : 1n;
    const ids: bigint[] = [];
    for (let i = fromId; i < nextGameId; i++) ids.push(i);

    Promise.all(
      ids.map((id) =>
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: MINESWEEPER_ABI,
          functionName: "getGame",
          args: [id],
        })
      )
    )
      .then((results) => {
        const games: StuckGame[] = [];
        const blockNum = Number(currentBlock);
        for (let i = 0; i < ids.length; i++) {
          const r = results[i] as readonly unknown[];
          const status = Number(r[10]);
          if (status !== 0 && status !== 1) continue;
          const startBlock = typeof r[11] === "bigint" ? r[11] : BigInt(Number(r[11]));
          const requiredBlocks = status === 0 ? CANCEL_BLOCKS_WAITING_FIRST_FLIP : CANCEL_BLOCKS_WAITING_VRF;
          const blocksElapsed = blockNum - Number(startBlock);
          const eligible = blockNum > Number(startBlock) + requiredBlocks;
          games.push({
            gameId: ids[i],
            player: r[0] as string,
            gridSize: Number(r[2]),
            status,
            startBlock,
            blocksElapsed,
            requiredBlocks,
            eligible,
          });
        }
        setStuckGames(games);
      })
      .catch(() => setStuckGames([]));
  }, [nextGameId, currentBlock, publicClient]);

  const handleDeposit = async () => {
    let wei: bigint;
    try {
      wei = parseEther(depositAmount);
    } catch {
      return;
    }
    if (wei <= 0n) return;
    setTxMessage(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: MINESWEEPER_ABI,
        functionName: "depositPool",
        value: wei,
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxMessage(`Deposited ${formatEth(wei)} ETH`);
      setDepositAmount("");
      refetchPoolHealth();
    } catch (e) {
      setTxMessage(e instanceof Error ? e.message : "Deposit failed");
    }
  };

  const handleWithdrawProfits = async () => {
    let wei: bigint;
    try {
      wei = parseEther(withdrawAmount);
    } catch {
      return;
    }
    if (wei <= 0n || wei > maxWithdrawable) return;
    setTxMessage(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: MINESWEEPER_ABI,
        functionName: "withdrawPoolProfits",
        args: [wei],
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxMessage(`Withdrew ${formatEth(wei)} ETH`);
      refetchPoolHealth();
    } catch (e) {
      setTxMessage(e instanceof Error ? e.message : "Withdraw failed");
    }
  };

  const handleWithdrawFees = async () => {
    if (fees <= 0n) return;
    setTxMessage(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: MINESWEEPER_ABI,
        functionName: "withdrawFees",
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxMessage(`Withdrew ${formatEth(fees)} ETH in fees`);
      refetchPoolHealth();
    } catch (e) {
      setTxMessage(e instanceof Error ? e.message : "Withdraw failed");
    }
  };

  const handleCancelStuck = async (gameId: bigint) => {
    setCancellingId(gameId);
    setTxMessage(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: MINESWEEPER_ABI,
        functionName: "cancelStuckGame",
        args: [gameId],
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxMessage(`Game ${gameId.toString()} cancelled`);
      setStuckGames((prev) => prev.filter((g) => g.gameId !== gameId));
      refetchPoolHealth();
    } catch (e) {
      setTxMessage(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col min-h-screen bg-white">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-4">
          <p className="text-gray-500 text-center">Connect your wallet to access the admin page.</p>
          <LandingHero />
        </main>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col min-h-screen bg-white">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="max-w-sm w-full px-4 py-6 border border-mine/40 bg-mine/10 rounded-[4px] text-center">
            <p className="text-mine font-medium">Unauthorized — connect owner wallet</p>
            <p className="text-gray-500 text-sm mt-2">Only the contract owner can access this page.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <Header />
      <main className="flex-1 flex flex-col items-center pt-6 pb-16 px-4 overflow-y-auto">
        <div className="w-full max-w-md space-y-6">
          <h1 className="text-2xl font-bold text-[#111111]">Admin</h1>

          {txMessage && (
            <div className="px-4 py-3 bg-accent-green/10 border border-accent-green/40 rounded-[4px] text-accent-green text-sm">
              {txMessage}
            </div>
          )}

          {/* 1. Pool Health */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Pool Health</h2>
            <p className="text-xs text-gray-500 mb-2">Auto-refreshes every 30s</p>
            <dl className="space-y-1.5 text-sm">
              <Row label="Pool balance" value={`${formatEth(pool)} ETH`} />
              <Row label="Reserved (active games)" value={`${formatEth(reserved)} ETH`} />
              <Row label="Fee balance" value={`${formatEth(fees)} ETH`} />
              <Row label="Contract ETH balance" value={`${formatEth(contractBalance)} ETH`} />
              <Row label="Owner wallet balance" value={`${formatEth(ownerWalletBalance)} ETH`} />
            </dl>
          </section>

          {/* 2. Deposit to Pool */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Deposit to Pool</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="0.0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-[4px] font-mono text-sm"
              />
              <button
                onClick={handleDeposit}
                disabled={isWritePending || !depositAmount}
                className="px-4 py-2 bg-base-blue text-white rounded-[4px] font-medium text-sm disabled:opacity-50"
              >
                Deposit
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Current pool: {formatEth(pool)} ETH (updates after confirm)</p>
          </section>

          {/* 3. Withdraw Pool Profits */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Withdraw Pool Profits</h2>
            <p className="text-sm text-gray-600 mb-2">Max withdrawable: {formatEth(maxWithdrawable)} ETH</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="0.0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-[4px] font-mono text-sm"
              />
              <button
                onClick={() => setWithdrawAmount(weiToInputString(maxWithdrawable))}
                className="px-2 py-2 text-gray-500 text-sm"
              >
                Max
              </button>
              <button
                onClick={handleWithdrawProfits}
                disabled={isWritePending || !withdrawAmount || maxWithdrawable <= 0n}
                className="px-4 py-2 bg-base-blue text-white rounded-[4px] font-medium text-sm disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>
          </section>

          {/* 4. Withdraw Fees */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Withdraw Fees</h2>
            <p className="text-sm text-gray-600 mb-2">Fee balance: {formatEth(fees)} ETH</p>
            <button
              onClick={handleWithdrawFees}
              disabled={isWritePending || fees <= 0n}
              className="px-4 py-2 bg-base-blue text-white rounded-[4px] font-medium text-sm disabled:opacity-50"
            >
              Withdraw All Fees
            </button>
          </section>

          {/* 5. Stuck Games */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Stuck Games</h2>
            {stuckGames.length === 0 ? (
              <p className="text-sm text-gray-500">No stuck games (WAITING_FIRST_FLIP / WAITING_VRF).</p>
            ) : (
              <ul className="space-y-3">
                {stuckGames.map((g) => (
                  <li
                    key={g.gameId.toString()}
                    className="p-3 border border-gray-200 rounded-[4px] text-sm space-y-1"
                  >
                    <p className="font-mono text-[#111111]">Game #{g.gameId.toString()}</p>
                    <p className="text-gray-600">Player: {shortAddress(g.player)}</p>
                    <p className="text-gray-600">Grid: {GRID_LABELS[g.gridSize] ?? g.gridSize}</p>
                    <p className="text-gray-600">Status: {STATUS_LABELS[g.status] ?? g.status}</p>
                    <p className="text-gray-600">Blocks elapsed: {g.blocksElapsed} (need {g.requiredBlocks} to cancel)</p>
                    <p className={g.eligible ? "text-accent-green" : "text-gray-500"}>
                      {g.eligible ? "Eligible for cancel" : "Not yet eligible"}
                    </p>
                    {g.eligible && (
                      <button
                        onClick={() => handleCancelStuck(g.gameId)}
                        disabled={cancellingId !== null}
                        className="mt-2 px-3 py-1.5 bg-mine/90 text-white rounded-[4px] text-xs font-medium disabled:opacity-50"
                      >
                        {cancellingId === g.gameId ? "Cancelling…" : "Cancel & Refund"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-mono text-[#111111]">{value}</dd>
    </div>
  );
}

function shortAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
