import type { Env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, paymentRequired, serverError } from "../lib/errors.js";
import { nowIso, uuidv4 } from "../lib/ids.js";
import { HOSTED_TRIAL_LIMIT, countSucceededAudits, isDeviceWhitelisted } from "./quota.js";

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
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct", // Circuit-breaker fallback for Stage B walker + Stage E spec/prototype
  "@cf/qwen/qwen3-30b-a3b-fp8", // Returns OpenAI-shape; kept allowlisted but unused by default in 1.1.3+
  "@cf/qwen/qwen2.5-coder-32b-instruct", // B-classify + B-model modeler A (code specialist, JSON-mode native)
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/openai/gpt-oss-120b", // kept for experimentation; no stage uses it by default
]);

async function enforceHostedTrialQuota(env: Env, deviceId: string, stage: string): Promise<void> {
  // meta-stage calls aren't counted toward the trial.
  if (stage === "meta") return;

  // Whitelisted devices skip the quota entirely.
  if (await isDeviceWhitelisted(env, deviceId)) return;

  // Count only SUCCEEDED audits, not distinct audit_ids touched by
  // /infer calls. A failed audit shouldn't burn the user's free slot.
  const lifetime = await countSucceededAudits(env, deviceId);
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
  // Workers AI returns a string for text models and a parsed object for
  // some models when response_format: { type: "json_object" } is set
  // (notably Qwen2.5-Coder). The client always wants a string, so we
  // normalize below.
  response?: unknown;
  usage?: AiRunUsage;
}

function isAiRunResult(x: unknown): x is AiRunResult {
  return typeof x === "object" && x !== null && ("response" in x || "usage" in x);
}

// Workers AI returns at least TWO distinct shapes across models:
//   1. Native-chat shape:  { response: string, usage: {...} }
//      — used by Llama 3.3 70B instruct, Llama 3.1 8B, Qwen2.5-Coder
//        (when response comes back as a string). Qwen2.5-Coder with
//        json_object returns response as a PARSED object — we stringify.
//   2. OpenAI-compatible shape: { choices: [{message: {content: string}}], usage: {...} }
//      — observed for @cf/qwen/qwen3-30b-a3b-fp8 (diag log confirmed
//        top_level_keys: [id, object, created, model, choices, ...,
//        usage]). The content field on choices[0].message IS the real
//        reply. Reading result.response would be undefined → "" →
//        empty-output retry → wasted neurons.
// Both shapes exist in production today; we normalize to a string.
function normalizeResponseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;

  // Native shape — try response field first.
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") {
    try {
      return JSON.stringify(r.response);
    } catch {
      /* fall through */
    }
  }

  // OpenAI-compatible shape — choices[0].message.content.
  const choices = r.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      /* fall through */
    }
  }

  return "";
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

    // Structured log of the shape Workers AI returned, so if a future
    // model returns a third variant we notice it instead of silently
    // emptying. Compact — just the classifier, not the raw object.
    try {
      const r = raw as Record<string, unknown>;
      const hasResponseString = typeof r.response === "string";
      const hasResponseObject = r.response !== null && typeof r.response === "object";
      const hasChoicesContent =
        Array.isArray(r.choices) &&
        (r.choices as Array<{ message?: { content?: unknown } }>)[0]?.message?.content !==
          undefined;
      const shape = hasResponseString
        ? "native_string"
        : hasResponseObject
          ? "native_object"
          : hasChoicesContent
            ? "openai_choices"
            : "unknown";
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          kind: "ai_shape",
          model: body.model,
          stage,
          response_format: body.response_format ?? "text",
          shape,
          completion_tokens: (r.usage as { completion_tokens?: number })?.completion_tokens,
        }),
      );
    } catch {
      /* never let a diag crash a real call */
    }
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
    text: normalizeResponseText(result.response),
    usage: {
      input_tokens: result.usage?.prompt_tokens ?? 0,
      output_tokens: result.usage?.completion_tokens ?? 0,
      neurons,
      latency_ms: latencyMs,
    },
  });
}
