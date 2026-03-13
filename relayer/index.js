/**
 * Minesweeper Gas Relayer
 *
 * Funds ephemeral session keys with a small amount of ETH so tile-flip
 * transactions can be submitted directly by the session key without the
 * player ever seeing a wallet popup.
 *
 * POST /fund  { gameId, sessionKeyAddress }
 *   1. Validates that sessionKeyAddress is the registered session key for
 *      gameId on the Minesweeper contract (on-chain read via viem).
 *   2. Sends FUND_AMOUNT_ETH to the session key address.
 *   3. Deduplicates per gameId – each game is funded at most once.
 *
 * GET  /health  → { ok: true, relayer: "0x…" }
 */

require("dotenv").config();

const express = require("express");
const {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  isAddress,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia, base }   = require("viem/chains");

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT             || "3001";
const CHAIN_ID         = parseInt(process.env.CHAIN_ID || "84532", 10);
const RPC_URL          = process.env.RPC_URL          || "https://sepolia.base.org";
const RELAYER_PK       = process.env.RELAYER_PRIVATE_KEY || "";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
  || "0xE2e2823454e331795E044CE4D81C49B51c3805Be";
const FUND_AMOUNT      = parseEther(process.env.FUND_AMOUNT_ETH || "0.0001");
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!RELAYER_PK || !RELAYER_PK.startsWith("0x")) {
  console.error("ERROR: RELAYER_PRIVATE_KEY is not set or invalid");
  process.exit(1);
}
if (!isAddress(CONTRACT_ADDRESS)) {
  console.error("ERROR: CONTRACT_ADDRESS is invalid:", CONTRACT_ADDRESS);
  process.exit(1);
}

const chain          = CHAIN_ID === 8453 ? base : baseSepolia;
const relayerAccount = privateKeyToAccount(/** @type {`0x${string}`} */ (RELAYER_PK));
const publicClient   = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient   = createWalletClient({
  account:   relayerAccount,
  chain,
  transport: http(RPC_URL),
});

console.log(`Relayer wallet : ${relayerAccount.address}`);
console.log(`Network        : ${chain.name} (chainId ${CHAIN_ID})`);
console.log(`Contract       : ${CONTRACT_ADDRESS}`);
console.log(`Fund amount    : ${process.env.FUND_AMOUNT_ETH || "0.0001"} ETH per game`);
console.log(`Allowed origins: ${FRONTEND_ORIGINS.join(", ")}`);

// ─── Minimal ABI (only getGame is needed) ─────────────────────────────────────

const GET_GAME_ABI = [
  {
    type: "function",
    name: "getGame",
    stateMutability: "view",
    inputs:  [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "player",          type: "address" },
      { name: "sessionKey",      type: "address" },
      { name: "gridSize",        type: "uint8"   },
      { name: "difficulty",      type: "uint8"   },
      { name: "entryFee",        type: "uint256" },
      { name: "maxPayout",       type: "uint256" },
      { name: "mineBitmask",     type: "uint64"  },
      { name: "revealedBitmask", type: "uint64"  },
      { name: "safeRevealed",    type: "uint8"   },
      { name: "totalSafe",       type: "uint8"   },
      { name: "status",          type: "uint8"   },
      { name: "startedAt",       type: "uint256" },
      { name: "endedAt",         type: "uint256" },
    ],
  },
];

// ─── In-memory dedup set ──────────────────────────────────────────────────────
// Persists for the process lifetime. Restarting funds a game at most once more,
// which is fine – the small duplicate cost is negligible on Base.

/** @type {Set<string>} */
const fundedGames = new Set();

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS – only allow configured frontend origins
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (FRONTEND_ORIGINS.includes(origin) || FRONTEND_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin",  origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, relayer: relayerAccount.address });
});

// ─── POST /fund ───────────────────────────────────────────────────────────────

app.post("/fund", async (req, res) => {
  const { gameId, sessionKeyAddress } = req.body || {};

  // Input validation
  if (!gameId || !sessionKeyAddress) {
    return res.status(400).json({ error: "Missing gameId or sessionKeyAddress" });
  }
  if (!isAddress(sessionKeyAddress)) {
    return res.status(400).json({ error: "Invalid sessionKeyAddress" });
  }

  const gameKey = String(gameId);

  // Idempotency – already funded this game in this process lifetime
  if (fundedGames.has(gameKey)) {
    console.log(`[fund] gameId=${gameKey} already funded – skipping`);
    return res.json({ ok: true, alreadyFunded: true });
  }

  try {
    // ── On-chain validation ──────────────────────────────────────────────────
    const game = await publicClient.readContract({
      address:      /** @type {`0x${string}`} */ (CONTRACT_ADDRESS),
      abi:          GET_GAME_ABI,
      functionName: "getGame",
      args:         [BigInt(gameId)],
    });

    const player     = game[0];
    const sessionKey = game[1];

    if (!player || player === "0x0000000000000000000000000000000000000000") {
      return res.status(404).json({ error: "Game not found" });
    }
    if (sessionKey.toLowerCase() !== sessionKeyAddress.toLowerCase()) {
      return res
        .status(403)
        .json({ error: "Session key does not match on-chain record" });
    }

    // ── Send ETH to session key ──────────────────────────────────────────────
    const hash = await walletClient.sendTransaction({
      to:    /** @type {`0x${string}`} */ (sessionKeyAddress),
      value: FUND_AMOUNT,
    });

    fundedGames.add(gameKey);
    console.log(
      `[fund] gameId=${gameKey} sessionKey=${sessionKeyAddress} tx=${hash}`
    );

    return res.json({ ok: true, hash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fund] error for gameId=${gameKey}:`, msg);
    return res.status(500).json({ error: "Failed to fund session key", detail: msg });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Relayer listening on :${PORT}`);
});
