import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

// Hosted-trial: every device gets 1 lifetime audit on Sina's Workers AI
// credits. After that, the CLI is pointed at the self-host guide.
export const HOSTED_TRIAL_LIMIT = 1;

const SELF_HOST_URL = "https://tpm-d3h.pages.dev/self-host";

export async function checkQuota(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  const lifetimeRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT audit_id) as c FROM usage_log
       WHERE device_id = ? AND audit_id IS NOT NULL AND status = 'ok'`,
  )
    .bind(auth.deviceId)
    .first<{ c: number }>();
  const lifetime = lifetimeRow?.c ?? 0;

  const remaining = Math.max(0, HOSTED_TRIAL_LIMIT - lifetime);
  const allowed = lifetime < HOSTED_TRIAL_LIMIT;

  return Response.json({
    ok: true,
    mode: "hosted_trial",
    limit: HOSTED_TRIAL_LIMIT,
    used: lifetime,
    remaining,
    allowances: {
      full_audit: allowed,
      quick_audit: true,
    },
    self_host: allowed
      ? null
      : {
          message:
            "You've used your free hosted audit. TPM is open source — run unlimited audits on your own Cloudflare Workers AI.",
          url: SELF_HOST_URL,
        },
  });
}
