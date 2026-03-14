/**
 * check-stuck-games.ts
 *
 * Scans all GameStarted events from the contract's deployment block, identifies
 * games that are still in a non-terminal state (WAITING_FIRST_FLIP or WAITING_VRF),
 * and cancels any that have been waiting for more than 24 hours.
 *
 * Usage:
 *   npx hardhat run scripts/check-stuck-games.ts --network baseSepolia
 *
 * Optional env overrides:
 *   STUCK_CONTRACT=0x…      override contract address
 *   DEPLOY_BLOCK=12345678   skip deployment-block binary search
 *   CHUNK_SIZE=2000         blocks per getLogs request (default: 2000)
 *   DRY_RUN=1               print stuck games but do not send cancellation txs
 */

import { ethers, artifacts } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = (
  process.env.STUCK_CONTRACT || "0xE2e2823454e331795E044CE4D81C49B51c3805Be"
) as `0x${string}`;

const CHUNK_SIZE  = parseInt(process.env.CHUNK_SIZE  || "2000", 10);
const DRY_RUN     = process.env.DRY_RUN === "1";

// ─── Types ───────────────────────────────────────────────────────────────────

enum GameStatus {
  WAITING_FIRST_FLIP = 0,
  WAITING_VRF        = 1,
  ACTIVE             = 2,
  CASHED_OUT         = 3,
  GAME_OVER          = 4,
  CANCELLED          = 5,
}

const STATUS_LABEL: Record<number, string> = {
  [GameStatus.WAITING_FIRST_FLIP]: "WAITING_FIRST_FLIP",
  [GameStatus.WAITING_VRF]:        "WAITING_VRF",
  [GameStatus.ACTIVE]:             "ACTIVE",
  [GameStatus.CASHED_OUT]:         "CASHED_OUT",
  [GameStatus.GAME_OVER]:          "GAME_OVER",
  [GameStatus.CANCELLED]:          "CANCELLED",
};

const TERMINAL_STATUSES = new Set([
  GameStatus.CASHED_OUT,
  GameStatus.GAME_OVER,
  GameStatus.CANCELLED,
]);

const CANCELLABLE_STATUSES = new Set([
  GameStatus.WAITING_FIRST_FLIP,
  GameStatus.WAITING_VRF,
]);

const TWENTY_FOUR_HOURS = 24n * 60n * 60n; // seconds

// ─── Deployment block discovery (binary search via eth_getCode) ───────────────

async function findDeploymentBlock(
  provider: ethers.JsonRpcProvider | ethers.BrowserProvider,
  address:  string,
  hi:       number,
): Promise<number> {
  // Verify contract exists right now
  const currentCode = await provider.getCode(address);
  if (currentCode === "0x") {
    throw new Error(`No contract found at ${address} on this network`);
  }

  console.log(`  Searching for deployment block via binary search (0 … ${hi})…`);
  let lo = 0;

  while (lo < hi) {
    const mid     = Math.floor((lo + hi) / 2);
    const midCode = await provider.getCode(address, mid);
    if (midCode !== "0x") {
      hi = mid; // already deployed at mid — search lower half
    } else {
      lo = mid + 1; // not yet deployed — search upper half
    }
  }

  return lo; // first block where code is present
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();

  const network      = await provider.getNetwork();
  const currentBlock = await provider.getBlockNumber();
  const currentTs    = BigInt((await provider.getBlock(currentBlock))!.timestamp);

  console.log("═".repeat(60));
  console.log("Minesweeper stuck-game scanner");
  console.log("═".repeat(60));
  console.log(`Network  : ${network.name} (chainId ${network.chainId})`);
  console.log(`Contract : ${CONTRACT_ADDRESS}`);
  console.log(`Signer   : ${signer.address}`);
  console.log(`Block    : ${currentBlock}`);
  if (DRY_RUN) console.log("Mode     : DRY RUN (no transactions will be sent)");
  console.log();

  // ── Load ABI from Hardhat artifact ────────────────────────────────────────
  const artifact = await artifacts.readArtifact("Minesweeper");
  const contract = new ethers.Contract(CONTRACT_ADDRESS, artifact.abi, signer);

  // ── Find deployment block ─────────────────────────────────────────────────
  let deployBlock: number;
  if (process.env.DEPLOY_BLOCK) {
    deployBlock = parseInt(process.env.DEPLOY_BLOCK, 10);
    console.log(`Deployment block : ${deployBlock} (from env DEPLOY_BLOCK)`);
  } else {
    deployBlock = await findDeploymentBlock(provider, CONTRACT_ADDRESS, currentBlock);
    console.log(`Deployment block : ${deployBlock} (found via binary search)`);
  }
  console.log();

  // ── Query all GameStarted events in chunks ────────────────────────────────
  const totalBlocks = currentBlock - deployBlock + 1;
  const chunks      = Math.ceil(totalBlocks / CHUNK_SIZE);
  console.log(
    `Scanning ${totalBlocks.toLocaleString()} blocks ` +
    `(${chunks} chunk${chunks === 1 ? "" : "s"} × ${CHUNK_SIZE})…`
  );

  const gameStartedFilter = contract.filters["GameStarted"]();
  const allGameIds        = new Set<bigint>();

  for (let i = 0; i < chunks; i++) {
    const from   = deployBlock + i * CHUNK_SIZE;
    const to     = Math.min(from + CHUNK_SIZE - 1, currentBlock);
    const events = await contract.queryFilter(gameStartedFilter, from, to);

    for (const e of events) {
      const log = e as ethers.EventLog;
      allGameIds.add(log.args.gameId as bigint);
    }

    // Progress indicator every 20 chunks
    if ((i + 1) % 20 === 0 || i === chunks - 1) {
      const pct = (((i + 1) / chunks) * 100).toFixed(0);
      process.stdout.write(`\r  ${pct}% (chunk ${i + 1}/${chunks})          `);
    }
  }
  console.log(`\nTotal games found : ${allGameIds.size}`);
  console.log();

  // ── Fetch current status for each game ───────────────────────────────────
  console.log("Fetching game states…");

  interface GameInfo {
    gameId:    bigint;
    player:    string;
    status:    GameStatus;
    startedAt: bigint;
    ageHours:  number;
    canCancel: boolean;
  }

  const nonTerminal: GameInfo[] = [];

  for (const gameId of allGameIds) {
    const g = await contract["getGame"](gameId);

    const status    = Number(g.status)  as GameStatus;
    const startedAt = g.startedAt       as bigint;
    const ageHours  = Number(currentTs - startedAt) / 3600;
    const canCancel =
      CANCELLABLE_STATUSES.has(status) &&
      currentTs > startedAt + TWENTY_FOUR_HOURS;

    if (!TERMINAL_STATUSES.has(status)) {
      nonTerminal.push({
        gameId,
        player:  g.player as string,
        status,
        startedAt,
        ageHours,
        canCancel,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const cancellable = nonTerminal.filter(g => g.canCancel);

  if (nonTerminal.length === 0) {
    console.log("No stuck games. All games have reached a terminal state.");
    return;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`STUCK GAMES (${nonTerminal.length} total, ${cancellable.length} eligible for cancellation)`);
  console.log("─".repeat(60));

  for (const g of nonTerminal) {
    const startedISO = new Date(Number(g.startedAt) * 1000).toISOString();
    console.log(`  Game ID  : ${g.gameId}`);
    console.log(`  Player   : ${g.player}`);
    console.log(`  Status   : ${STATUS_LABEL[g.status] ?? g.status}`);
    console.log(`  Started  : ${startedISO}  (${g.ageHours.toFixed(1)} h ago)`);
    if (g.canCancel) {
      console.log(`  Cancel   : eligible`);
    } else if (CANCELLABLE_STATUSES.has(g.status)) {
      const hoursLeft = (24 - g.ageHours).toFixed(1);
      console.log(`  Cancel   : not yet — ${hoursLeft} h remaining until 24-h timeout`);
    } else {
      console.log(`  Cancel   : not eligible (status ${STATUS_LABEL[g.status]})`);
    }
    console.log("─".repeat(60));
  }

  // ── Cancel eligible games ─────────────────────────────────────────────────
  if (cancellable.length === 0) {
    console.log("\nNothing to cancel yet. Re-run after the 24-h timeouts have elapsed.");
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN: would cancel ${cancellable.length} game(s). Set DRY_RUN=0 to execute.`);
    return;
  }

  console.log(`\nCancelling ${cancellable.length} game(s)…`);

  let succeeded = 0;
  let failed    = 0;

  for (const g of cancellable) {
    try {
      process.stdout.write(`  game ${g.gameId} (${g.player})… `);
      const tx:      ethers.ContractTransaction   = await contract["cancelStuckGame"](g.gameId);
      const receipt: ethers.ContractTransactionReceipt | null = await tx.wait();
      console.log(`✓  tx ${receipt?.hash ?? "unknown"}`);
      succeeded++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗  ${msg.split("\n")[0]}`);
      failed++;
    }
  }

  console.log();
  console.log(`Results: ${succeeded} cancelled, ${failed} failed`);
  if (succeeded > 0) {
    console.log("Players have been refunded their net bets (entry fee minus 5% platform fee).");
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
