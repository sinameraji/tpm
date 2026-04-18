import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

export const QUOTAS = {
  free: { full_audits_lifetime: 1, full_audits_monthly: 0, quick_audits_monthly: Infinity },
  pro: { full_audits_lifetime: Infinity, full_audits_monthly: 20, quick_audits_monthly: Infinity },
  team: {
    full_audits_lifetime: Infinity,
    full_audits_monthly: 50,
    quick_audits_monthly: Infinity,
  },
} as const;

export async function validateLicense(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  const lic = await env.DB.prepare(
    `SELECT tier, status, current_period_start, current_period_end, seat_count
       FROM licenses WHERE device_id = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(auth.deviceId)
    .first<{
      tier: "free" | "pro" | "team";
      status: string;
      current_period_start: string | null;
      current_period_end: string | null;
      seat_count: number;
    }>();

  if (!lic) {
    return Response.json({
      ok: true,
      tier: "free",
      status: "active",
      quota: QUOTAS.free,
      note: "no license row — defaulting to free",
    });
  }

  const quota = QUOTAS[lic.tier];

  // Count usage for this window.
  const lifetimeRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM audits WHERE device_id = ? AND status = 'succeeded'`,
  )
    .bind(auth.deviceId)
    .first<{ c: number }>();
  const lifetime = lifetimeRow?.c ?? 0;

  const monthlyStart = lic.current_period_start ?? new Date(new Date().setDate(1)).toISOString();
  const monthlyRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM audits WHERE device_id = ? AND status = 'succeeded' AND started_at >= ?`,
  )
    .bind(auth.deviceId, monthlyStart)
    .first<{ c: number }>();
  const monthly = monthlyRow?.c ?? 0;

  return Response.json({
    ok: true,
    tier: lic.tier,
    status: lic.status,
    seat_count: lic.seat_count,
    current_period_start: lic.current_period_start,
    current_period_end: lic.current_period_end,
    quota: {
      full_audits_lifetime: quota.full_audits_lifetime,
      full_audits_monthly: quota.full_audits_monthly,
    },
    usage: {
      full_audits_lifetime: lifetime,
      full_audits_this_period: monthly,
    },
  });
}
