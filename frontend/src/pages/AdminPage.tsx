import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useBlockNumber, usePublicClient, useBalance } from "wagmi";
import { parseEther } from "viem";
import { Header } from "@/components/Header";
import { LandingHero } from "@/components/LandingHero";
import { MINESWEEPER_ABI } from "@/abis/Minesweeper";
import { CONTRACT_ADDRESS, formatEth, CANCEL_BLOCKS_WAITING_VRF } from "@/lib/config";

const GRID_LABELS: Record<number, string> = {
  0: "5×4",
  1: "5×6",
  2: "5×10",
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
  // Poll block number instead of watch (avoids "filter not found" on Alchemy/HTTP RPCs)
  const { data: currentBlock = 0n } = useBlockNumber({
    watch: false,
    query: { refetchInterval: 12_000 },
  });

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

  const { data: ownerBalanceData } = useBalance({
    address: isOwner ? connectedAddress! : undefined,
    query: { refetchInterval: 30_000 },
  });
  const ownerWalletBalance = ownerBalanceData?.value ?? 0n;

  const pool = poolHealth?.[0] ?? 0n;
  const reserved = poolHealth?.[1] ?? 0n;
  const fees = poolHealth?.[2] ?? 0n;
  const contractBalance = poolHealth?.[3] ?? 0n;

  const { writeContractAsync, isPending: isWritePending } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawPercent, setWithdrawPercent] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [stuckGames, setStuckGames] = useState<StuckGame[]>([]);
  const [cancellingId, setCancellingId] = useState<bigint | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyContractAddress = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setTxMessage("Copy failed");
    }
  };

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
          if (status !== 1) continue; // only WAITING_VRF can be cancelled (stuck after startGame)
          const startBlock = typeof r[11] === "bigint" ? r[11] : BigInt(Number(r[11]));
          const requiredBlocks = CANCEL_BLOCKS_WAITING_VRF;
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

  const handleWithdraw = async () => {
    const pct = withdrawPercent.trim() === "" ? 100 : Number(withdrawPercent);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return;
    const percentBps = BigInt(Math.round(pct * 100)); // 0–100 → 0–10000 bps
    const recipient = withdrawRecipient.trim()
      ? (withdrawRecipient as `0x${string}`)
      : "0x0000000000000000000000000000000000000000" as `0x${string}`;
    setTxMessage(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: MINESWEEPER_ABI,
        functionName: "withdraw",
        args: [percentBps, recipient],
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxMessage(`Withdrew ${pct}% of pool${recipient === "0x0000000000000000000000000000000000000000" ? " to owner" : ""}`);
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

          {/* Contract address — click to copy */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-2">Contract</h2>
            <button
              type="button"
              onClick={copyContractAddress}
              className="w-full text-left px-3 py-2.5 font-mono text-sm text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-[4px] transition-colors focus:outline-none focus:ring-2 focus:ring-base-blue/40"
              title="Click to copy"
            >
              <span className="break-all">{CONTRACT_ADDRESS}</span>
              {copied && (
                <span className="ml-2 text-accent-green font-sans font-medium">Copied!</span>
              )}
            </button>
            <p className="text-xs text-gray-500 mt-1.5">Click to copy address</p>
          </section>

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

          {/* 3. Withdraw Pool */}
          <section className="border border-gray-200 rounded-[4px] p-4">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Withdraw Pool</h2>
            <p className="text-sm text-gray-600 mb-2">Pool: {formatEth(pool)} ETH. Percent 0–100 (empty = 100%). Optional recipient (empty = owner).</p>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="100"
                  value={withdrawPercent}
                  onChange={(e) => setWithdrawPercent(e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-200 rounded-[4px] font-mono text-sm"
                />
                <span className="text-sm text-gray-600">%</span>
                <input
                  type="text"
                  placeholder="Recipient (optional)"
                  value={withdrawRecipient}
                  onChange={(e) => setWithdrawRecipient(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-[4px] font-mono text-sm"
                />
              </div>
              <button
                onClick={handleWithdraw}
                disabled={isWritePending || pool <= 0n}
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
              <p className="text-sm text-gray-500">No stuck games (WAITING_VRF).</p>
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
