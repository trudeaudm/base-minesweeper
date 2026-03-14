/**
 * Minimal ABI subset used by the relayer.
 * Only getGame is needed – to verify a session key is legitimately
 * registered for a given gameId before funding it with gas money.
 */
export const RELAYER_ABI = [
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
      { name: "startBlock",      type: "uint256" },
      { name: "startedAt",       type: "uint256" },
      { name: "endedAt",         type: "uint256" },
    ],
  },
] as const;
