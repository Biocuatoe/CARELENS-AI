/** A new random key for one user intent (one confirm dialog, one form). Retries of that intent reuse it; a new intent gets a new one. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
