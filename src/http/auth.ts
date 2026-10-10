import { createHash, timingSafeEqual } from "node:crypto";

export function tokensMatch(provided: string, expected: string): boolean {
  // Hash first so both buffers are 32 bytes; timingSafeEqual throws on length mismatch.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
