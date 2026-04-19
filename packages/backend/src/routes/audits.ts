import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nowIso } from "../lib/ids.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createAudit(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  let body: { audit_id: string; target: string; tpm_version: string; session_id: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw badRequest("invalid JSON body");
  }
  if (!body.audit_id || !UUID_RE.test(body.audit_id)) throw badRequest("audit_id must be uuid");
  if (!body.target) throw badRequest("target required");

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version)
     VALUES (?, ?, ?, ?, ?, 'running', 'hosted_trial', ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(body.audit_id, auth.deviceId, body.session_id, body.target, now, body.tpm_version)
    .run();

  return Response.json({
    ok: true,
    audit_id: body.audit_id,
    r2_prefix: `audits/${auth.deviceId}/${body.audit_id}/`,
  });
}

export async function finishAudit(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const auditId = url.pathname.split("/")[2];
  if (!auditId || !UUID_RE.test(auditId)) throw badRequest("invalid audit id");
  let body: {
    status?: "succeeded" | "failed" | "canceled";
    total_neurons?: number;
    cost_per_stage?: Record<string, number>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw badRequest("invalid JSON body");
  }
  const status = body.status ?? "succeeded";
  await env.DB.prepare(
    `UPDATE audits SET ended_at = ?, status = ?, total_neurons = ?, cost_per_stage_json = ?,
       r2_prefix = ?
     WHERE id = ? AND device_id = ?`,
  )
    .bind(
      nowIso(),
      status,
      body.total_neurons ?? null,
      JSON.stringify(body.cost_per_stage ?? {}),
      `audits/${auth.deviceId}/${auditId}/`,
      auditId,
      auth.deviceId,
    )
    .run();
  return Response.json({ ok: true });
}

export async function listAudits(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const rows = await env.DB.prepare(
    `SELECT id, target, started_at, ended_at, status, total_neurons, tier_at_run
       FROM audits WHERE device_id = ?
       ORDER BY started_at DESC
       LIMIT 50`,
  )
    .bind(auth.deviceId)
    .all<{
      id: string;
      target: string;
      started_at: string;
      ended_at: string | null;
      status: string;
      total_neurons: number | null;
      tier_at_run: string;
    }>();
  return Response.json({ ok: true, audits: rows.results ?? [] });
}

// Upload/download a named artifact file. Key is scoped to device_id.
export async function uploadArtifact(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const parts = url.pathname.split("/"); // /audits/{id}/artifacts/{name}
  const auditId = parts[2];
  const artifactName = parts[4];
  if (!auditId || !UUID_RE.test(auditId)) throw badRequest("invalid audit id");
  if (!artifactName || /[^A-Za-z0-9._/-]/.test(artifactName))
    throw badRequest("invalid artifact name");

  // Verify the audit belongs to this device.
  const owns = await env.DB.prepare(`SELECT 1 as x FROM audits WHERE id = ? AND device_id = ?`)
    .bind(auditId, auth.deviceId)
    .first<{ x: number }>();
  if (!owns) throw notFound("audit not found for this device");

  const key = `audits/${auth.deviceId}/${auditId}/${artifactName}`;
  const bodyStream = request.body;
  if (!bodyStream) throw badRequest("missing body");
  await env.ARTIFACTS.put(key, bodyStream, {
    httpMetadata: {
      contentType: request.headers.get("content-type") ?? "application/octet-stream",
    },
  });
  return Response.json({ ok: true, key });
}

export async function downloadArtifact(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const auditId = parts[2];
  const artifactName = parts[4];
  if (!auditId || !UUID_RE.test(auditId)) throw badRequest("invalid audit id");
  if (!artifactName) throw badRequest("invalid artifact name");

  const owns = await env.DB.prepare(`SELECT 1 as x FROM audits WHERE id = ? AND device_id = ?`)
    .bind(auditId, auth.deviceId)
    .first<{ x: number }>();
  if (!owns) throw notFound("audit not found for this device");

  const key = `audits/${auth.deviceId}/${auditId}/${artifactName}`;
  const obj = await env.ARTIFACTS.get(key);
  if (!obj) throw notFound();
  return new Response(obj.body as unknown as BodyInit, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" },
  });
}
