/**
 * Minesweeper Gas Relayer
 *
 * Funds ephemeral session keys with a small amount of ETH so that tile-flip
 * transactions can be submitted directly by the session key without the
 * player ever seeing a gas popup.
 *
 * Security model:
 *   - Only funds addresses that are registered as session keys for a live game
 *     on the Minesweeper contract (verified via on-chain read).
 *   - Each gameId is funded at most once (in-memory dedup; reset on restart is
 *     acceptable – worst-case a session key gets funded twice, still tiny cost).
 *   - The economic cost to drain the relayer = sum of entry fees paid, which
 *     far exceeds what the relayer pays out in gas on Base L2.
 */

import express, { Request, Response, NextFunction } from "express";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { RELAYER_ABI } from "./abi";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT             ?? "3001";
const CHAIN_ID         = parseInt(process.env.CHAIN_ID ?? "84532");
const RPC_URL          = process.env.RPC_URL          ?? "https://sepolia.base.org";
const RELAYER_PK       = (process.env.RELAYER_PRIVATE_KEY ?? "") as `0x${string}`;
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS ?? "") as `0x${string}`;
const FUND_AMOUNT      = parseEther(process.env.FUND_AMOUNT_ETH ?? "0.0001");
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map(s => s.trim());

if (!RELAYER_PK || !RELAYER_PK.startsWith("0x")) {
  console.error("RELAYER_PRIVATE_KEY is not set or invalid – exiting");
  process.exit(1);
}
if (!isAddress(CONTRACT_ADDRESS)) {
  console.error("CONTRACT_ADDRESS is not set or invalid – exiting");
  process.exit(1);
}

const chain          = CHAIN_ID === 8453 ? base : baseSepolia;
const relayerAccount = privateKeyToAccount(RELAYER_PK);
const publicClient   = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient   = createWalletClient({
  account:   relayerAccount,
  chain,
  transport: http(RPC_URL),
});

console.log(`Relayer wallet: ${relayerAccount.address}`);
console.log(`Chain:          ${chain.name} (${CHAIN_ID})`);
console.log(`Contract:       ${CONTRACT_ADDRESS}`);
console.log(`Fund amount:    ${process.env.FUND_AMOUNT_ETH ?? "0.0001"} ETH per game`);

// ─── State ────────────────────────────────────────────────────────────────────

/** gameIds that have already been funded this process lifetime. */
const fundedGames = new Set<string>();

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin ?? "";
  if (FRONTEND_ORIGINS.includes(origin) || FRONTEND_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin",  origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, relayer: relayerAccount.address });
});

/**
 * POST /fund
 * Body: { gameId: string, sessionKeyAddress: string }
 *
 * Validates that sessionKeyAddress is the registered session key for gameId
 * on-chain, then sends FUND_AMOUNT ETH to sessionKeyAddress.
 */
app.post("/fund", async (req: Request, res: Response) => {
  const { gameId, sessionKeyAddress } = req.body as {
    gameId?:           string;
    sessionKeyAddress?: string;
  };

  if (!gameId || !sessionKeyAddress) {
    res.status(400).json({ error: "Missing gameId or sessionKeyAddress" });
    return;
  }
  if (!isAddress(sessionKeyAddress)) {
    res.status(400).json({ error: "Invalid sessionKeyAddress" });
    return;
  }

  const gameKey = String(gameId);

  // Idempotent: already funded this game
  if (fundedGames.has(gameKey)) {
    console.log(`[fund] gameId=${gameKey} already funded – skipping`);
    res.json({ ok: true, alreadyFunded: true });
    return;
  }

  try {
    // ── On-chain validation ────────────────────────────────────────────────
    const game = await publicClient.readContract({
      address:      CONTRACT_ADDRESS,
      abi:          RELAYER_ABI,
      functionName: "getGame",
      args:         [BigInt(gameId)],
    });

    const player     = game[0] as string;
    const sessionKey = game[1] as string;

    if (player === "0x0000000000000000000000000000000000000000") {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    if (sessionKey.toLowerCase() !== sessionKeyAddress.toLowerCase()) {
      res.status(403).json({ error: "Session key does not match on-chain record" });
      return;
    }

    // ── Fund ──────────────────────────────────────────────────────────────
    const hash = await walletClient.sendTransaction({
      to:    sessionKeyAddress,
      value: FUND_AMOUNT,
    });

    fundedGames.add(gameKey);
    console.log(`[fund] gameId=${gameKey} sessionKey=${sessionKeyAddress} hash=${hash}`);

    res.json({ ok: true, hash });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fund] error for gameId=${gameKey}:`, msg);
    res.status(500).json({ error: "Failed to fund session key", detail: msg });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Relayer listening on :${PORT}`);
});
