import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

// Hosted-trial: every device gets 1 lifetime audit on the maintainer's
// Workers AI credits. Whitelisted devices skip the check entirely.
export const HOSTED_TRIAL_LIMIT = 1;

const SELF_HOST_URL = "https://tpm-d3h.pages.dev/self-host";

export async function isDeviceWhitelisted(env: Env, deviceId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT is_whitelisted FROM devices WHERE id = ?`)
    .bind(deviceId)
    .first<{ is_whitelisted: number | null }>();
  return (row?.is_whitelisted ?? 0) === 1;
}

// Count only SUCCEEDED audits toward the trial. A failed audit (e.g.,
// Stage A returned empty, parse error) should not burn the user's one
// free slot.
export async function countSucceededAudits(env: Env, deviceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM audits
       WHERE device_id = ? AND status = 'succeeded'`,
  )
    .bind(deviceId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function checkQuota(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  const [whitelisted, lifetime] = await Promise.all([
    isDeviceWhitelisted(env, auth.deviceId),
    countSucceededAudits(env, auth.deviceId),
  ]);

  if (whitelisted) {
    return Response.json({
      ok: true,
      mode: "whitelisted",
      limit: null,
      used: lifetime,
      remaining: null,
      allowances: { full_audit: true, quick_audit: true },
      self_host: null,
    });
  }

  const remaining = Math.max(0, HOSTED_TRIAL_LIMIT - lifetime);
  const allowed = lifetime < HOSTED_TRIAL_LIMIT;

  return Response.json({
    ok: true,
    mode: "hosted_trial",
    limit: HOSTED_TRIAL_LIMIT,
    used: lifetime,
    remaining,
    allowances: { full_audit: allowed, quick_audit: true },
    self_host: allowed
      ? null
      : {
          message:
            "You've used your free hosted audit. TPM is open source — run unlimited audits on your own Cloudflare Workers AI.",
          url: SELF_HOST_URL,
        },
  });
}
