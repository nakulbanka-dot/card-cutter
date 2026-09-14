/**
 * Eased progress for count-up animations.
 *
 * Pulled out of the component and clamped at BOTH ends. A
 * requestAnimationFrame callback receives the timestamp the frame began, which
 * can be earlier than a performance.now() reading taken moments before it — so
 * elapsed time can arrive negative. Clamping only the upper bound let that
 * through, the cubic inverted, and the homepage counter rendered -42,764.
 */
export function easeOutCubic(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1;
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return 1 - Math.pow(1 - t, 3);
}

/** Value to display partway through a count-up to `target`. */
export function countUpValue(target: number, elapsedMs: number, durationMs: number): number {
  return Math.round(target * easeOutCubic(elapsedMs, durationMs));
}
