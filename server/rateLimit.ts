/**
 * A small fixed-window limiter. On serverless hosts each instance keeps its own
 * counts, so this only slows down casual abuse. Put a real limiter in front of
 * the proxy if the app ever gets traffic worth protecting.
 */
const WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, max = DEFAULT_MAX, now = Date.now()): boolean {
  if (hits.size > 2000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

export function resetRateLimit(): void {
  hits.clear();
}
