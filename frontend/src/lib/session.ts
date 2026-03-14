/**
 * Session Key Management
 *
 * An ephemeral Ethereum keypair lives in sessionStorage for the lifetime of one
 * game. The player authorises this address in startGame() (1 wallet popup).
 * Every subsequent tile flip and cashout is signed directly by the session key
 * – no wallet interaction required.
 *
 * Gas funding:
 *   The player sends entry fee + SESSION_GAS_BUDGET in startGame(); the
 *   contract forwards the gas budget to the session key (self-funded flips/cashout).
 *
 * Helpers exported:
 *   getOrCreateSessionKey()      – generate/load the ephemeral Account
 *   getSessionKey()              – retrieve current Account (null if none)
 *   clearSessionKey()            – remove from storage on game end
 *   getSessionKeyAddress()       – convenience: address string or null
 *   createSessionWalletClient()  – viem WalletClient that signs as session key
 */

import { createWalletClient, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Account, Chain } from "viem";

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

/**
 * Create a viem WalletClient backed by the current session key private key.
 * Returns null if no session key is loaded yet.
 *
 * The resulting client submits transactions directly to the RPC endpoint
 * (bypassing the user's wallet), so the player sees no popup.
 */
export function createSessionWalletClient(chain: Chain, rpcUrl: string) {
  const pk = sessionStorage.getItem(STORAGE_KEY) as `0x${string}` | null;
  if (!pk) return null;
  return createWalletClient({
    account:   privateKeyToAccount(pk),
    chain,
    transport: http(rpcUrl),
  });
}
