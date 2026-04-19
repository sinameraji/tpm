import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { HOSTED_TRIAL_LIMIT } from "./quota.js";

// Post-OSS pivot: every device is "free (hosted trial)". No paid tiers.
// Unlimited usage requires self-host; see /self-host docs.
export async function validateLicense(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const lifetimeRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT audit_id) as c FROM usage_log
       WHERE device_id = ? AND audit_id IS NOT NULL AND status = 'ok'`,
  )
    .bind(auth.deviceId)
    .first<{ c: number }>();
  const used = lifetimeRow?.c ?? 0;
  return Response.json({
    ok: true,
    mode: "hosted_trial",
    limit: HOSTED_TRIAL_LIMIT,
    used,
    remaining: Math.max(0, HOSTED_TRIAL_LIMIT - used),
  });
}
