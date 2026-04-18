import type { Env } from "../env.js";
import { badRequest, forbidden } from "../lib/errors.js";
import { issueAccessToken, issueRefreshToken } from "../lib/jwt.js";
import { nowIso } from "../lib/ids.js";
import { ipFromRequest, rateLimit } from "../middleware/rate-limit.js";

interface RegisterBody {
  device_id: string;
  fingerprint_hash: string;
  tpm_version: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export async function registerDevice(request: Request, env: Env): Promise<Response> {
  const ip = ipFromRequest(request);
  await rateLimit(env, `device_register:${ip}`, 5, 60 * 60 * 24);

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    throw badRequest("invalid JSON body");
  }
  if (!body.device_id || !UUID_RE.test(body.device_id)) {
    throw badRequest("device_id must be a uuid v4");
  }
  if (!body.fingerprint_hash || !SHA256_RE.test(body.fingerprint_hash)) {
    throw badRequest("fingerprint_hash must be a hex sha256");
  }
  if (!body.tpm_version) throw badRequest("tpm_version is required");

  const now = nowIso();

  const banned = await env.DB.prepare("SELECT banned_at FROM devices WHERE id = ?")
    .bind(body.device_id)
    .first<{ banned_at: string | null }>();
  if (banned?.banned_at) throw forbidden("device banned");

  await env.DB.prepare(
    `INSERT INTO devices (id, fingerprint_hash, first_seen_at, last_seen_at, ip_first_seen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       fingerprint_hash = excluded.fingerprint_hash,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(body.device_id, body.fingerprint_hash, now, now, ip)
    .run();

  // Every device gets a free-tier license stub on first register; upgrade
  // webhooks (M15) mutate tier on the existing row.
  await env.DB.prepare(
    `INSERT INTO licenses (id, device_id, tier, status, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), ?, 'free', 'active', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM licenses WHERE device_id = ?)`,
  )
    .bind(body.device_id, now, now, body.device_id)
    .run();

  const tierRow = await env.DB.prepare(
    "SELECT tier FROM licenses WHERE device_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(body.device_id)
    .first<{ tier: "free" | "pro" | "team" }>();
  const tier = tierRow?.tier ?? "free";

  const [accessToken, refreshToken] = await Promise.all([
    issueAccessToken(body.device_id, tier, env.JWT_SECRET),
    issueRefreshToken(body.device_id, env.JWT_SECRET),
  ]);

  return Response.json({
    ok: true,
    device_id: body.device_id,
    tier,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 60 * 60 * 24,
  });
}
