/**
 * Session Key Management
 *
 * A session key is an ephemeral Ethereum account (private key) held in the
 * browser's sessionStorage. The player signs once at game start authorising
 * this address to flip tiles on their behalf.
 *
 * The session key signs real Ethereum transactions. For a production deployment
 * a relayer (e.g. Privy, Alchemy Account Kit, or a custom backend) pays the
 * gas for session-key-signed transactions so the player never sees a gas popup
 * while playing.
 *
 * For this scaffold we generate the keypair locally and expose helpers to:
 *   - generate / load / clear a session key
 *   - sign tile-flip transactions (for use with a relayer)
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Account } from "viem";

const STORAGE_KEY = "minesweeper_session_pk";

/** Generate (or load existing) session key and return the viem Account. */
export function getOrCreateSessionKey(): Account {
  let pk = sessionStorage.getItem(STORAGE_KEY) as `0x${string}` | null;
  if (!pk) {
    pk = generatePrivateKey();
    sessionStorage.setItem(STORAGE_KEY, pk);
  }
  return privateKeyToAccount(pk);
}

/** Get the current session key account (null if none). */
export function getSessionKey(): Account | null {
  const pk = sessionStorage.getItem(STORAGE_KEY) as `0x${string}` | null;
  if (!pk) return null;
  return privateKeyToAccount(pk);
}

/** Clear session key from storage (call on game end). */
export function clearSessionKey(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Get just the address of the current session key. */
export function getSessionKeyAddress(): `0x${string}` | null {
  const acc = getSessionKey();
  return acc?.address ?? null;
}
