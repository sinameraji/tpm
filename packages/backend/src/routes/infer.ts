import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, paymentRequired, serverError } from "../lib/errors.js";
import { nowIso, uuidv4 } from "../lib/ids.js";
import { HOSTED_TRIAL_LIMIT } from "./quota.js";

export interface InferRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: "text" | "json";
  stream?: boolean;

  audit_id?: string;
  stage?: "A" | "B" | "C" | "D" | "E" | "F" | "meta";
  session_id?: string;
}

const ALLOWED_MODELS = new Set<string>([
  "@cf/openai/gpt-oss-120b",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
]);

async function enforceHostedTrialQuota(env: Env, deviceId: string, stage: string): Promise<void> {
  // meta-stage calls aren't counted toward the trial.
  if (stage === "meta") return;

  const liferow = await env.DB.prepare(
    "SELECT COUNT(DISTINCT audit_id) as c FROM usage_log WHERE device_id = ? AND audit_id IS NOT NULL AND status = 'ok'",
  )
    .bind(deviceId)
    .first<{ c: number }>();
  const lifetime = liferow?.c ?? 0;
  if (lifetime >= HOSTED_TRIAL_LIMIT) {
    throw paymentRequired(
      "You've used your free hosted audit. TPM is open source — see https://tpm-d3h.pages.dev/self-host to run unlimited audits on your own Cloudflare Workers AI.",
      {
        mode: "hosted_trial",
        used: lifetime,
        limit: HOSTED_TRIAL_LIMIT,
        self_host: "https://tpm-d3h.pages.dev/self-host",
      },
    );
  }
}

interface AiRunUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface AiRunResult {
  response?: string;
  usage?: AiRunUsage;
}

function isAiRunResult(x: unknown): x is AiRunResult {
  return typeof x === "object" && x !== null && ("response" in x || "usage" in x);
}

// Workers AI pricing is expressed in "neurons" server-side. We approximate
// here from token counts when the upstream response doesn't include a
// neurons field — a conservative ~0.01 neurons/token until the API returns
// exact figures. M18 dogfood calibrates against real invoices.
function approxNeurons(usage: AiRunUsage | undefined): number {
  const tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  return Math.round(tokens * 0.01 * 100) / 100;
}

export async function infer(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);

  let body: InferRequest;
  try {
    body = (await request.json()) as InferRequest;
  } catch {
    throw badRequest("invalid JSON body");
  }

  if (!body.model) throw badRequest("model is required");
  if (!ALLOWED_MODELS.has(body.model)) {
    throw badRequest("unsupported model", { model: body.model, allowed: [...ALLOWED_MODELS] });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw badRequest("messages must be a non-empty array");
  }

  const stage = body.stage ?? "meta";
  await enforceHostedTrialQuota(env, auth.deviceId, stage);

  const callId = uuidv4();
  const startedAt = Date.now();
  const requestAt = nowIso();

  let result: AiRunResult;
  try {
    const raw = (await env.AI.run(
      body.model as Parameters<typeof env.AI.run>[0],
      {
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        ...(body.response_format === "json" ? { response_format: { type: "json_object" } } : {}),
      } as Parameters<typeof env.AI.run>[1],
    )) as unknown;
    if (!isAiRunResult(raw)) {
      throw serverError("unexpected AI response shape");
    }
    result = raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI call failed";
    await env.DB.prepare(
      `INSERT INTO usage_log (id, device_id, audit_id, session_id, stage, model, request_at,
        input_tokens, output_tokens, neurons, latency_ms, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?)`,
    )
      .bind(
        callId,
        auth.deviceId,
        body.audit_id ?? null,
        body.session_id ?? callId,
        stage,
        body.model,
        requestAt,
        null,
        null,
        0,
        Date.now() - startedAt,
        msg,
      )
      .run();
    throw serverError(msg);
  }

  const latencyMs = Date.now() - startedAt;
  const neurons = approxNeurons(result.usage);

  await env.DB.prepare(
    `INSERT INTO usage_log (id, device_id, audit_id, session_id, stage, model, request_at,
      input_tokens, output_tokens, neurons, latency_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
  )
    .bind(
      callId,
      auth.deviceId,
      body.audit_id ?? null,
      body.session_id ?? callId,
      stage,
      body.model,
      requestAt,
      result.usage?.prompt_tokens ?? null,
      result.usage?.completion_tokens ?? null,
      neurons,
      latencyMs,
    )
    .run();

  return Response.json({
    ok: true,
    call_id: callId,
    model: body.model,
    text: result.response ?? "",
    usage: {
      input_tokens: result.usage?.prompt_tokens ?? 0,
      output_tokens: result.usage?.completion_tokens ?? 0,
      neurons,
      latency_ms: latencyMs,
    },
  });
}
