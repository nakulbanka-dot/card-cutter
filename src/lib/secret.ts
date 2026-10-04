import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a supplied secret matches the expected one, in constant time.
 *
 * `supplied !== expected` stops at the first character that differs, so how
 * long a wrong guess takes leaks how much of it was right. Both sides are
 * hashed first because timingSafeEqual needs equal lengths, and comparing
 * lengths directly would leak the secret's length instead.
 */
export function secretMatches(supplied: string | null | undefined, expected: string): boolean {
  if (typeof supplied !== "string") return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
