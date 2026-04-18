import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, serverError } from "../lib/errors.js";
import { nowIso } from "../lib/ids.js";

// Stripe price IDs wired via env vars at deploy time. Fallback defaults
// let the endpoint respond usefully in dev.
const PRICE_IDS = {
  pro: "price_pro_monthly",
  team: "price_team_seat_monthly",
};

interface CreateCheckoutBody {
  tier: "pro" | "team";
  seat_count?: number;
  success_url?: string;
  cancel_url?: string;
}

interface StripeSessionResponse {
  id: string;
  url: string;
}

export async function createCheckoutSession(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  let body: CreateCheckoutBody;
  try {
    body = (await request.json()) as CreateCheckoutBody;
  } catch {
    throw badRequest("invalid JSON body");
  }

  if (body.tier !== "pro" && body.tier !== "team") {
    throw badRequest("tier must be 'pro' or 'team'");
  }
  const quantity = body.tier === "team" ? Math.max(1, body.seat_count ?? 1) : 1;

  if (!env.STRIPE_SECRET_KEY) {
    throw serverError("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  const price = PRICE_IDS[body.tier];
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", price);
  params.set("line_items[0][quantity]", String(quantity));
  params.set("client_reference_id", auth.deviceId);
  params.set("metadata[device_id]", auth.deviceId);
  params.set("metadata[tier]", body.tier);
  params.set("metadata[seat_count]", String(quantity));
  params.set("allow_promotion_codes", "true");
  if (body.success_url) params.set("success_url", body.success_url);
  else
    params.set(
      "success_url",
      "https://usetpm.dev/upgrade/success?session_id={CHECKOUT_SESSION_ID}",
    );
  if (body.cancel_url) params.set("cancel_url", body.cancel_url);
  else params.set("cancel_url", "https://usetpm.dev/upgrade/cancel");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw serverError(`Stripe checkout failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as StripeSessionResponse;
  return Response.json({ ok: true, session_id: data.id, url: data.url });
}

export async function createPortalSession(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!env.STRIPE_SECRET_KEY) throw serverError("Stripe is not configured.");

  const lic = await env.DB.prepare(
    `SELECT stripe_customer_id FROM licenses WHERE device_id = ? AND stripe_customer_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(auth.deviceId)
    .first<{ stripe_customer_id: string }>();
  if (!lic?.stripe_customer_id) {
    throw badRequest("no Stripe customer found for this device — you haven't upgraded yet");
  }

  const params = new URLSearchParams();
  params.set("customer", lic.stripe_customer_id);
  params.set("return_url", "https://usetpm.dev/account");
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw serverError(`portal session failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { url: string };
  return Response.json({ ok: true, url: data.url });
}

// Device status polling for `tpm upgrade` — returns current tier.
export async function deviceStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const deviceId = url.pathname.split("/")[2];
  if (!deviceId) throw badRequest("device_id path param required");

  const lic = await env.DB.prepare(
    `SELECT tier, status, updated_at FROM licenses WHERE device_id = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(deviceId)
    .first<{ tier: string; status: string; updated_at: string }>();

  if (!lic) {
    return Response.json({ ok: true, tier: "free", status: "active", found: false });
  }
  return Response.json({
    ok: true,
    tier: lic.tier,
    status: lic.status,
    updated_at: lic.updated_at,
    found: true,
  });
}

export async function activateCode(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  let body: { code: string };
  try {
    body = (await request.json()) as { code: string };
  } catch {
    throw badRequest("invalid JSON body");
  }
  if (!body.code) throw badRequest("code is required");
  const activation = await env.DB.prepare(
    `SELECT tier, used_at FROM activation_codes WHERE code = ?`,
  )
    .bind(body.code)
    .first<{ tier: string; used_at: string | null }>();
  if (!activation) throw badRequest("invalid activation code");
  if (activation.used_at) throw badRequest("activation code already used");

  await env.DB.prepare(
    `UPDATE activation_codes SET used_at = ?, used_by_device_id = ? WHERE code = ?`,
  )
    .bind(nowIso(), auth.deviceId, body.code)
    .run();

  await env.DB.prepare(
    `UPDATE licenses SET tier = ?, status = 'active', updated_at = ? WHERE device_id = ?`,
  )
    .bind(activation.tier, nowIso(), auth.deviceId)
    .run();

  return Response.json({ ok: true, tier: activation.tier });
}
