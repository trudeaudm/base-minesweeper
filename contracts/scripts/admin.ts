/**
 * admin.ts — Consolidated contract admin script
 *
 * Set COMMAND and CONTRACT_ADDRESS (env or .env). Optional env for some commands:
 *   AMOUNT_ETH    (seed)   ETH to deposit into pool
 *   DEPLOY_BLOCK  (stuck)  Override deployment block for event scan
 *   CHUNK_SIZE    (stuck)  Blocks per getLogs chunk (default 2000)
 *   DRY_RUN=1     (stuck)  List eligible games but do not send cancel txs
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... COMMAND=health npx hardhat run scripts/admin.ts --network baseSepolia
 *   CONTRACT_ADDRESS=0x... COMMAND=drain npx hardhat run scripts/admin.ts --network baseSepolia
 *   CONTRACT_ADDRESS=0x... COMMAND=seed AMOUNT_ETH=0.05 npx hardhat run scripts/admin.ts --network baseSepolia
 *   CONTRACT_ADDRESS=0x... COMMAND=stuck npx hardhat run scripts/admin.ts --network baseSepolia
 */

import { ethers, network, artifacts } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || "").trim() || undefined;
const COMMAND = (process.env.COMMAND || "").trim().toLowerCase();

// Block-based cancellation: only before first flip (must match Minesweeper.sol)
const CANCEL_BLOCKS_WAITING_FIRST_FLIP = 100;

enum GameStatus {
  WAITING_FIRST_FLIP = 0,
  WAITING_VRF = 1,
  ACTIVE = 2,
  CASHED_OUT = 3,
  GAME_OVER = 4,
  CANCELLED = 5,
}

const STATUS_LABEL: Record<number, string> = {
  [GameStatus.WAITING_FIRST_FLIP]: "WAITING_FIRST_FLIP",
  [GameStatus.WAITING_VRF]: "WAITING_VRF",
  [GameStatus.ACTIVE]: "ACTIVE",
  [GameStatus.CASHED_OUT]: "CASHED_OUT",
  [GameStatus.GAME_OVER]: "GAME_OVER",
  [GameStatus.CANCELLED]: "CANCELLED",
};

const CANCELLABLE_STATUSES = new Set([GameStatus.WAITING_FIRST_FLIP]);

async function getContractAndOwner() {
  const address = CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("CONTRACT_ADDRESS is not set (set in env or .env)");
  }
  const [signer] = await ethers.getSigners();
  const contract = await ethers.getContractAt("Minesweeper", address);
  const ownerAddress = await contract.owner();
  if (ownerAddress.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not the contract owner ${ownerAddress}`);
  }
  return { contract, signer, address };
}

async function printHealth(
  contract: Awaited<ReturnType<typeof ethers.getContractAt>>,
  signer: { address: string }
) {
  const [pool, reserved, fees, contractBalance] = await contract.getPoolHealth();
  const ownerBalance = await ethers.provider.getBalance(signer.address);
  console.log("Pool:      ", ethers.formatEther(pool), "ETH");
  console.log("Reserved:  ", ethers.formatEther(reserved), "ETH");
  console.log("Fees:      ", ethers.formatEther(fees), "ETH");
  console.log("Contract:  ", ethers.formatEther(contractBalance), "ETH");
  console.log("Owner:     ", ethers.formatEther(ownerBalance), "ETH");
}

async function findDeploymentBlock(
  provider: ethers.Provider,
  address: string,
  hi: number
): Promise<number> {
  const currentCode = await provider.getCode(address);
  if (currentCode === "0x") {
    throw new Error(`No contract at ${address}`);
  }
  let lo = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midCode = await provider.getCode(address, mid);
    if (midCode !== "0x") hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function main() {
  if (!COMMAND) {
    throw new Error("COMMAND is not set. Use COMMAND=health|drain|seed|stuck");
  }
  if (!["health", "drain", "seed", "stuck"].includes(COMMAND)) {
    throw new Error(`Unknown COMMAND=${COMMAND}. Use health, drain, seed, or stuck.`);
  }

  console.log("Network:  ", network.name);
  console.log("Contract: ", CONTRACT_ADDRESS || "(not set)");
  console.log("Command:  ", COMMAND);
  console.log();

  const provider = ethers.provider;

  if (COMMAND === "health") {
    const address = CONTRACT_ADDRESS;
    if (!address) throw new Error("CONTRACT_ADDRESS is not set");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("Minesweeper", address);
    console.log("── Pool health ──");
    await printHealth(contract, signer);
    return;
  }

  if (COMMAND === "seed") {
    const address = CONTRACT_ADDRESS;
    if (!address) throw new Error("CONTRACT_ADDRESS is not set");
    const amountStr = process.env.AMOUNT_ETH;
    if (!amountStr) throw new Error("AMOUNT_ETH is required for COMMAND=seed (e.g. AMOUNT_ETH=0.05)");
    const amount = ethers.parseEther(amountStr);
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("Minesweeper", address);

    const [poolBefore] = await contract.getPoolHealth();
    console.log("── Before ──");
    console.log("Pool: ", ethers.formatEther(poolBefore), "ETH");
    console.log("\nDepositing", ethers.formatEther(amount), "ETH into pool...");
    const tx = await contract.depositPool({ value: amount });
    await tx.wait();
    console.log("  tx:", tx.hash);

    const [poolAfter, reserved, fees, contractBal] = await contract.getPoolHealth();
    console.log("\n── After ──");
    console.log("Pool:      ", ethers.formatEther(poolAfter), "ETH");
    console.log("Reserved:  ", ethers.formatEther(reserved), "ETH");
    console.log("Fees:      ", ethers.formatEther(fees), "ETH");
    console.log("Contract:  ", ethers.formatEther(contractBal), "ETH");
    return;
  }

  const { contract, signer, address } = await getContractAndOwner();

  if (COMMAND === "drain") {
    const [pool, reserved, fees, contractBalance] = await contract.getPoolHealth();
    const ownerBefore = await ethers.provider.getBalance(signer.address);
    console.log("── Before ──");
    console.log("Contract pool:      ", ethers.formatEther(pool), "ETH");
    console.log("Contract reserved: ", ethers.formatEther(reserved), "ETH");
    console.log("Contract fees:     ", ethers.formatEther(fees), "ETH");
    console.log("Contract balance:  ", ethers.formatEther(contractBalance), "ETH");
    console.log("Owner balance:     ", ethers.formatEther(ownerBefore), "ETH");

    if (pool > 0n) {
      console.log("\nWithdrawing 100% of pool to owner:", ethers.formatEther(pool), "ETH");
      const tx1 = await contract.withdraw(0, ethers.ZeroAddress); // 0 => 100%, zero => owner
      await tx1.wait();
      console.log("  tx:", tx1.hash);
    } else {
      console.log("\nPool is empty, nothing to withdraw");
    }
    if (fees > 0n) {
      console.log("Withdrawing fees:", ethers.formatEther(fees), "ETH");
      const tx2 = await contract.withdrawFees();
      await tx2.wait();
      console.log("  tx:", tx2.hash);
    } else {
      console.log("No fees to withdraw");
    }

    const [poolAfter, reservedAfter, feesAfter, contractBalanceAfter] = await contract.getPoolHealth();
    const ownerAfter = await ethers.provider.getBalance(signer.address);
    console.log("\n── After ──");
    console.log("Contract pool:      ", ethers.formatEther(poolAfter), "ETH");
    console.log("Contract reserved: ", ethers.formatEther(reservedAfter), "ETH");
    console.log("Contract fees:     ", ethers.formatEther(feesAfter), "ETH");
    console.log("Contract balance:  ", ethers.formatEther(contractBalanceAfter), "ETH");
    console.log("Owner balance:     ", ethers.formatEther(ownerAfter), "ETH");
    return;
  }

  if (COMMAND === "stuck") {
    const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "2000", 10);
    const DRY_RUN = process.env.DRY_RUN === "1";
    const currentBlock = await provider.getBlockNumber();

    let deployBlock: number;
    if (process.env.DEPLOY_BLOCK) {
      deployBlock = parseInt(process.env.DEPLOY_BLOCK, 10);
      console.log("Deployment block:", deployBlock, "(from DEPLOY_BLOCK)");
    } else {
      deployBlock = await findDeploymentBlock(provider, address, currentBlock);
      console.log("Deployment block:", deployBlock);
    }

    const artifact = await artifacts.readArtifact("Minesweeper");
    const c = new ethers.Contract(address, artifact.abi, signer);
    const totalBlocks = currentBlock - deployBlock + 1;
    const chunks = Math.ceil(totalBlocks / CHUNK_SIZE);
    console.log("Scanning", totalBlocks, "blocks for GameStarted events...");

    const gameStartedFilter = c.filters["GameStarted"]();
    const allGameIds = new Set<bigint>();
    for (let i = 0; i < chunks; i++) {
      const from = deployBlock + i * CHUNK_SIZE;
      const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
      const events = await c.queryFilter(gameStartedFilter, from, to);
      for (const e of events) {
        const log = e as ethers.EventLog;
        allGameIds.add(log.args.gameId as bigint);
      }
    }
    console.log("Games found:", allGameIds.size);

    interface GameInfo {
      gameId: bigint;
      player: string;
      status: number;
      startBlock: bigint;
      requiredBlocks: number;
      canCancel: boolean;
    }
    const cancellable: GameInfo[] = [];

    for (const gameId of allGameIds) {
      const g = await c.getGame(gameId);
      const status = Number(g.status);
      if (!CANCELLABLE_STATUSES.has(status)) continue;
      const startBlock = typeof g.startBlock === "bigint" ? g.startBlock : BigInt(g.startBlock.toString());
      const requiredBlocks = CANCEL_BLOCKS_WAITING_FIRST_FLIP;
      const canCancel = currentBlock > Number(startBlock) + requiredBlocks;
      if (canCancel) {
        cancellable.push({
          gameId,
          player: g.player as string,
          status,
          startBlock,
          requiredBlocks,
          canCancel: true,
        });
      }
    }

    if (cancellable.length === 0) {
      console.log("No eligible stuck games to cancel.");
      return;
    }

    console.log("\nEligible stuck games (block-based):", cancellable.length);
    for (const g of cancellable) {
      console.log(
        "  Game", g.gameId.toString(), g.player,
        STATUS_LABEL[g.status] ?? g.status,
        "startBlock", g.startBlock.toString(), "+", g.requiredBlocks, "blocks"
      );
    }

    if (DRY_RUN) {
      console.log("\nDRY_RUN=1: no transactions sent. Unset DRY_RUN to cancel.");
      return;
    }

    console.log("\nCancelling", cancellable.length, "game(s)...");
    let succeeded = 0;
    let failed = 0;
    for (const g of cancellable) {
      try {
        const tx = await c.cancelStuckGame(g.gameId);
        await tx.wait();
        console.log("  ", g.gameId.toString(), "✓", tx.hash);
        succeeded++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("  ", g.gameId.toString(), "✗", msg.split("\n")[0]);
        failed++;
      }
    }
    console.log("Result:", succeeded, "cancelled,", failed, "failed");
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
