/**
 * Web sign-in secrets.
 *
 * - Generated secrets (100 random bits, see loginSecret) are stored as a plain SHA-256 hex digest: guessing
 *   them offline is infeasible, and the check is case-insensitive because they are read aloud.
 * - A secret CHOSEN by the owner (for example the shared showcase password) may be weak, so a bare digest is not
 *   enough: it is stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>` (random 16-byte salt, WebCrypto PBKDF2).
 *   The iteration count is stored with the hash, so lowering LOGIN_PBKDF2_ITERATIONS (Workers Free CPU budget)
 *   never breaks existing credentials. Workers caps PBKDF2 at 100 000 iterations.
 * - The online guess rate is limited per network by AUTH_FAILURE_LIMITER (session.ts); a weak chosen password is
 *   still weak, which is why the runbook rotates it after the demo.
 */
import { hex, sha256Hex, timingSafeEqualHex } from "./util";

const SCHEME = "pbkdf2-sha256";
export const MAX_PBKDF2_ITERATIONS = 100_000;
const DUMMY_SALT = new Uint8Array(16);

async function pbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Salted, slow hash for an owner-chosen secret. The password is used exactly as given (case-sensitive). */
export async function hashChosenSecret(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${SCHEME}$${iterations}$${hex(salt)}$${await pbkdf2Hex(password, salt, iterations)}`;
}

export async function legacyDigest(secret: string): Promise<string> {
  return sha256Hex(secret.trim().toLowerCase());
}

/**
 * Checks a presented secret against what is stored. `stored` null (unknown account) still spends a comparable
 * amount of work so response time does not reveal whether the account exists.
 */
export async function verifyLoginSecret(stored: string | null, presented: string, defaultIterations: number): Promise<boolean> {
  if (stored?.startsWith(`${SCHEME}$`)) {
    const [, iterText, saltHex, hashHex] = stored.split("$");
    const iterations = Number(iterText);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS || !saltHex || !hashHex || saltHex.length % 2 !== 0) return false;
    return timingSafeEqualHex(await pbkdf2Hex(presented, fromHex(saltHex), iterations), hashHex);
  }
  if (stored === null) {
    await pbkdf2Hex(presented, DUMMY_SALT, defaultIterations);
    return false;
  }
  return timingSafeEqualHex(await legacyDigest(presented), stored);
}
