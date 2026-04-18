import type { Env } from "../env.js";
import { tooMany } from "../lib/errors.js";

// KV-backed sliding window. Cheap, race-prone at high QPS but fine for
// low-QPS public endpoints (device register, license validate).
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000));
  const kvKey = `rl:${key}:${windowStart}`;
  const current = Number((await env.RATE_LIMITS.get(kvKey)) ?? "0");
  if (current >= limit) throw tooMany();
  await env.RATE_LIMITS.put(kvKey, String(current + 1), {
    expirationTtl: windowSeconds + 60,
  });
}

export function ipFromRequest(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
