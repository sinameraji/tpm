import type { Env } from "../env.js";
import { badRequest, unauthorized, serverError } from "../lib/errors.js";
import { nowIso, uuidv4 } from "../lib/ids.js";

// Verify Stripe webhook signature using Web Crypto. Stripe sends:
//   Stripe-Signature: t=1234,v1=<hex>
// v1 = HMAC-SHA256(secret, timestamp + "." + raw_body).
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = signatureHeader.split(",").map((p) => p.split("="));
  const ts = parts.find((p) => p[0] === "t")?.[1];
  const v1 = parts.find((p) => p[0] === "v1")?.[1];
  if (!ts || !v1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${rawBody}`)));
  const hex = Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

interface StripeCheckoutCompleted {
  id: string;
  type: "checkout.session.completed";
  data: {
    object: {
      id: string;
      client_reference_id?: string;
      customer?: string;
      subscription?: string;
      metadata?: { device_id?: string; tier?: "pro" | "team"; seat_count?: string };
    };
  };
}

interface StripeSubscriptionEvent {
  id: string;
  type:
    | "customer.subscription.updated"
    | "customer.subscription.deleted"
    | "invoice.payment_failed";
  data: {
    object: {
      id: string;
      customer?: string;
      status?: string;
      cancel_at_period_end?: boolean;
      current_period_start?: number;
      current_period_end?: number;
      items?: { data: Array<{ price: { id: string } }> };
    };
  };
}

function randomCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .replace(/(.{4})/g, "$1-")
    .replace(/-$/, "");
}

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  const sigHeader = request.headers.get("stripe-signature");
  if (!sigHeader) throw unauthorized("missing stripe-signature");
  if (!env.STRIPE_WEBHOOK_SECRET) throw serverError("STRIPE_WEBHOOK_SECRET not set");

  const rawBody = await request.text();
  const ok = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) throw unauthorized("invalid stripe signature");

  let event: { id: string; type: string };
  try {
    event = JSON.parse(rawBody) as { id: string; type: string };
  } catch {
    throw badRequest("invalid JSON");
  }

  // Idempotency: bail if we've already processed this event id.
  const existing = await env.DB.prepare(`SELECT id FROM webhook_events WHERE id = ?`)
    .bind(event.id)
    .first<{ id: string }>();
  if (existing) {
    return Response.json({ ok: true, replay: true });
  }
  await env.DB.prepare(
    `INSERT INTO webhook_events (id, type, received_at, status, raw_json)
       VALUES (?, ?, ?, 'received', ?)`,
  )
    .bind(event.id, event.type, nowIso(), rawBody)
    .run();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event as unknown as StripeCheckoutCompleted, env);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "invoice.payment_failed":
        await handleSubscriptionEvent(event as unknown as StripeSubscriptionEvent, env);
        break;
      default:
        // ignore
        break;
    }
    await env.DB.prepare(
      `UPDATE webhook_events SET status = 'processed', processed_at = ? WHERE id = ?`,
    )
      .bind(nowIso(), event.id)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `UPDATE webhook_events SET status = 'failed', processed_at = ? WHERE id = ?`,
    )
      .bind(nowIso(), event.id)
      .run();
    throw serverError(msg);
  }

  return Response.json({ ok: true });
}

async function handleCheckoutCompleted(event: StripeCheckoutCompleted, env: Env): Promise<void> {
  const session = event.data.object;
  const deviceId = session.client_reference_id ?? session.metadata?.device_id;
  const tier = session.metadata?.tier;
  const seatCount = Number(session.metadata?.seat_count ?? 1);
  if (!deviceId || !tier) return;

  await env.DB.prepare(
    `UPDATE licenses SET tier = ?, status = 'active', seat_count = ?,
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       updated_at = ?
     WHERE device_id = ?`,
  )
    .bind(
      tier,
      seatCount,
      session.customer ?? null,
      session.subscription ?? null,
      nowIso(),
      deviceId,
    )
    .run();

  // Issue an activation code in case the CLI's polling missed the upgrade.
  const code = randomCode();
  await env.DB.prepare(`INSERT INTO activation_codes (code, tier, created_at) VALUES (?, ?, ?)`)
    .bind(code, tier, nowIso())
    .run();
}

async function handleSubscriptionEvent(event: StripeSubscriptionEvent, env: Env): Promise<void> {
  const sub = event.data.object;
  const customerId = sub.customer;
  if (!customerId) return;
  const status = sub.status ?? "unknown";
  const newTier = event.type === "customer.subscription.deleted" ? "free" : undefined;
  const cpsIso = sub.current_period_start
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null;
  const cpeIso = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const subId = sub.id;
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, license_id, device_id, stripe_customer_id, price_id, status,
       cancel_at_period_end, current_period_start, current_period_end, raw_event_json, created_at, updated_at)
     SELECT ?, l.id, l.device_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM licenses l WHERE l.stripe_customer_id = ?
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       cancel_at_period_end = excluded.cancel_at_period_end,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       raw_event_json = excluded.raw_event_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      subId,
      customerId,
      sub.items?.data?.[0]?.price?.id ?? "",
      status,
      sub.cancel_at_period_end ? 1 : 0,
      cpsIso,
      cpeIso,
      JSON.stringify(event),
      nowIso(),
      nowIso(),
      customerId,
    )
    .run();

  if (newTier) {
    await env.DB.prepare(
      `UPDATE licenses SET tier = ?, status = 'canceled', canceled_at = ?, updated_at = ?
         WHERE stripe_customer_id = ?`,
    )
      .bind(newTier, nowIso(), nowIso(), customerId)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE licenses SET status = ?,
         current_period_start = COALESCE(?, current_period_start),
         current_period_end = COALESCE(?, current_period_end),
         updated_at = ?
         WHERE stripe_customer_id = ?`,
    )
      .bind(status, cpsIso, cpeIso, nowIso(), customerId)
      .run();
  }
}

export { uuidv4 };
