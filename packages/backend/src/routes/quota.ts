import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { QUOTAS } from "./license.js";

export async function checkQuota(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  const tier = auth.tier;
  const quota = QUOTAS[tier];

  const lifetimeRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT audit_id) as c FROM usage_log
       WHERE device_id = ? AND audit_id IS NOT NULL AND status = 'ok'`,
  )
    .bind(auth.deviceId)
    .first<{ c: number }>();
  const lifetime = lifetimeRow?.c ?? 0;

  const monthStart = new Date(new Date().setDate(1)).toISOString();
  const monthRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT audit_id) as c FROM usage_log
       WHERE device_id = ? AND audit_id IS NOT NULL AND status = 'ok'
       AND request_at >= ?`,
  )
    .bind(auth.deviceId, monthStart)
    .first<{ c: number }>();
  const monthly = monthRow?.c ?? 0;

  const remainingLifetime =
    quota.full_audits_lifetime === Infinity
      ? null
      : Math.max(0, quota.full_audits_lifetime - lifetime);
  const remainingMonthly =
    quota.full_audits_monthly === Infinity || quota.full_audits_monthly === 0
      ? null
      : Math.max(0, quota.full_audits_monthly - monthly);

  // For free tier, full_audits_monthly is 0 meaning "not monthly-metered" —
  // only the lifetime cap applies. For pro/team, both caps apply.
  const monthlyCapApplies = quota.full_audits_monthly !== Infinity && quota.full_audits_monthly > 0;
  const fullAuditAllowed =
    (quota.full_audits_lifetime === Infinity || lifetime < quota.full_audits_lifetime) &&
    (!monthlyCapApplies || monthly < quota.full_audits_monthly);

  return Response.json({
    ok: true,
    tier,
    quota: {
      full_audits_lifetime:
        quota.full_audits_lifetime === Infinity ? "unlimited" : quota.full_audits_lifetime,
      full_audits_monthly:
        quota.full_audits_monthly === Infinity ? "unlimited" : quota.full_audits_monthly,
    },
    usage: {
      full_audits_lifetime: lifetime,
      full_audits_this_period: monthly,
      period_start: monthStart,
    },
    allowances: {
      full_audit: fullAuditAllowed,
      quick_audit: true, // always allowed
      remaining_lifetime: remainingLifetime,
      remaining_monthly: remainingMonthly,
    },
    upgrade_hint: fullAuditAllowed
      ? null
      : {
          message: `${tier} tier has reached its full-audit limit. Run \`tpm upgrade\` to continue.`,
          url: "https://usetpm.dev/upgrade",
        },
  });
}
