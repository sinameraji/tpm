// Unified stage execution with bounded retries + structured failure
// modes. Every stage gets: pre-flight token estimate, empty-output
// retry, parse-failure retry, schema-violation retry, semantic
// post-validation. Hard ceiling: 3 total model calls per stage.
//
// The goal is that no audit ever fails with a cryptic "Unexpected end
// of JSON input" — failures always surface as a StageError with the
// stage name, session_id, attempt history, and last output preview.

import { type z } from "zod";
import type { Logger } from "../../core/logger.js";
import type { CompleteOptionsExt, ModelGateway, Message } from "../../gateway/index.js";
import { calcCost } from "../../core/cost-calc.js";
import { estimateMessagesTokens, maxContextFor } from "./tokens.js";
import type { ValidationResult } from "./validators.js";

export type StageName = "A" | "B" | "C" | "D" | "E" | "F" | "meta";

export interface Attempt {
  n: number;
  kind: "initial" | "retry-empty" | "retry-parse" | "retry-schema" | "retry-semantic";
  // Which model this attempt actually hit (differs from spec.model
  // once the circuit breaker swaps to the fallback).
  model?: string;
  inputTokens: number;
  outputTokens: number;
  outputPreview: string;
  failure?: string;
  latencyMs: number;
  // Repurposed 1.2.0+: integer micro-USD cost for this attempt.
  // Computed here from the gateway's Usage via core/cost-calc.ts so
  // the gateway stays agnostic about pricing. See db/schema.ts
  // COST_COLUMN_SEMANTIC for how this flows into SQLite.
  neurons?: number;
}

export class StageError extends Error {
  constructor(
    message: string,
    readonly stage: StageName,
    readonly sessionId: string,
    readonly attempts: Attempt[],
  ) {
    super(message);
    this.name = "StageError";
  }
}

export interface StageRunnerDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
}

export interface StageSpec<T> {
  name: StageName;
  label: string; // human-friendly progress label
  model: string;
  // After this many consecutive empty responses from `model`, the
  // runner swaps to `fallbackModel` for subsequent attempts. Guards
  // against one broken model / shape monopolizing the retry budget.
  // Defaults to 2; set fallbackModel to activate.
  fallbackModel?: string;
  emptyStreakBeforeFallback?: number;
  maxTokens: number;
  temperature: number;
  responseFormat: "text" | "json";

  systemPrompt: string;
  userPrompt: string; // caller builds this from its input + inputSchema

  // Parse raw text into the structured output; throws on parse failure.
  parse: (raw: string) => unknown;

  // Validate structure (Zod). Returns the typed output or throws.
  validate: (parsed: unknown) => T;

  // Validate semantics (business rules beyond structure). Non-throwing.
  semanticCheck?: (out: T) => ValidationResult;

  // If true, a parsed + validated output that would be treated as
  // "semantically empty" by the stage is ACCEPTED rather than retried.
  // e.g., `{steps: [], outcome: {status: "skipped"}}` for B-walk on a
  // project with no user-facing journey. Set by the caller.
  acceptSemanticEmpty?: (out: T) => boolean;

  maxRetries?: number; // default 2 extra attempts on top of initial

  // Opt in to ephemeral prompt caching on the system prompt. Only
  // stages with a large, audit-agnostic system prompt should set
  // this (A, C, D, F per the v1.2.0 plan). Gateways that don't
  // support caching ignore it.
  cacheSystem?: boolean;
}

const DEFAULT_MAX_RETRIES = 2;

function stripCodeFences(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const m = /^```(?:json|html|markdown|md)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  return m?.[1]?.trim() ?? trimmed;
}

function preview(s: string, max = 400): string {
  if (!s) return "(empty)";
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export interface StageResult<T> {
  output: T;
  attempts: Attempt[];
  totalNeurons: number;
  totalLatencyMs: number;
}

export async function runStage<T>(
  spec: StageSpec<T>,
  deps: StageRunnerDeps,
): Promise<StageResult<T>> {
  const maxAttempts = 1 + (spec.maxRetries ?? DEFAULT_MAX_RETRIES);
  const attempts: Attempt[] = [];

  // --- Pre-flight: token budget sanity ---
  const initialMessages: Message[] = [
    { role: "system", content: spec.systemPrompt },
    { role: "user", content: spec.userPrompt },
  ];
  const estIn = estimateMessagesTokens(initialMessages);
  const ctx = maxContextFor(spec.model);
  if (estIn + spec.maxTokens > ctx) {
    throw new StageError(
      `Stage ${spec.name}: prompt too large. Estimated ${estIn} input tokens + ${spec.maxTokens} output budget exceeds ${ctx} context window for ${spec.model}. Trim the input or raise the context.`,
      spec.name,
      deps.sessionId,
      [],
    );
  }
  deps.logger.info(
    {
      stage: spec.name,
      model: spec.model,
      est_input_tokens: estIn,
      max_tokens: spec.maxTokens,
      ctx,
    },
    "stage preflight ok",
  );

  // Conversation we mutate across retries (so retry attempts see the
  // previous failed output + the correction instruction).
  let messages: Message[] = initialMessages;
  let currentMaxTokens = spec.maxTokens;
  // Circuit breaker: after N consecutive empty responses from the
  // active model, swap to the declared fallback.
  let activeModel = spec.model;
  let emptyStreak = 0;
  const streakThreshold = spec.emptyStreakBeforeFallback ?? 2;

  for (let n = 1; n <= maxAttempts; n++) {
    const attempt: Attempt = {
      n,
      kind: n === 1 ? "initial" : "retry-empty",
      inputTokens: 0,
      outputTokens: 0,
      outputPreview: "",
      latencyMs: 0,
    };
    const started = Date.now();
    let rawText = "";
    try {
      const opts: CompleteOptionsExt = {
        temperature: spec.temperature,
        responseFormat: spec.responseFormat,
        auditId: deps.auditId,
        sessionId: deps.sessionId,
        stage: spec.name,
        maxTokens: currentMaxTokens,
        ...(spec.cacheSystem ? { cacheSystem: true } : {}),
      };
      const completion = await deps.gateway.complete(activeModel, messages, opts);
      rawText = completion.text ?? "";
      attempt.model = activeModel;
      attempt.inputTokens = completion.usage.inputTokens;
      attempt.outputTokens = completion.usage.outputTokens;
      // Price the attempt in integer micro-USD. Anthropic usage
      // carries the four-kind breakdown we need (input, output,
      // cache-read, cache-creation). Workers-AI usage lacks the
      // cache fields — calcCost treats the missing ones as zero.
      attempt.neurons = calcCost(activeModel, completion.usage).totalMicroUsd;
      attempt.latencyMs = completion.usage.latencyMs ?? Date.now() - started;
      attempt.outputPreview = preview(rawText);
    } catch (err) {
      attempt.failure = err instanceof Error ? err.message : String(err);
      attempt.latencyMs = Date.now() - started;
      attempts.push(attempt);
      throw new StageError(
        `Stage ${spec.name}: gateway call threw on attempt ${n}: ${attempt.failure}`,
        spec.name,
        deps.sessionId,
        attempts,
      );
    }

    // --- Empty output check ---
    if (!rawText.trim()) {
      attempt.kind = n === 1 ? "initial" : "retry-empty";
      attempt.failure = "empty output";
      attempts.push(attempt);
      emptyStreak += 1;
      deps.logger.warn(
        {
          stage: spec.name,
          attempt: n,
          model: activeModel,
          empty_streak: emptyStreak,
          usage: { inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens },
        },
        "stage returned empty",
      );
      // Circuit breaker: if we've seen enough consecutive empties from
      // this model and a fallback is declared, switch for the next
      // attempt. Reset the conversation so the fallback doesn't
      // inherit error-correction messages from the primary.
      if (
        emptyStreak >= streakThreshold &&
        spec.fallbackModel &&
        activeModel !== spec.fallbackModel
      ) {
        deps.logger.warn(
          {
            stage: spec.name,
            from: activeModel,
            to: spec.fallbackModel,
            after_empty_streak: emptyStreak,
          },
          "stage circuit breaker opened: switching to fallback model",
        );
        activeModel = spec.fallbackModel;
        emptyStreak = 0;
        messages = initialMessages;
        currentMaxTokens = spec.maxTokens;
        continue;
      }
      if (n >= maxAttempts) {
        throw new StageError(
          `Stage ${spec.name}: model returned empty output across ${maxAttempts} attempts. Last call: ${attempt.outputTokens} output tokens, ${attempt.inputTokens} input tokens.`,
          spec.name,
          deps.sessionId,
          attempts,
        );
      }
      currentMaxTokens *= 2;
      continue;
    }

    // Non-empty response — the model IS working at the protocol layer.
    // Reset the empty-streak so parse/schema retries don't trip the
    // circuit breaker (a cleanly-formatted bad JSON is a prompt issue,
    // not a model-broken issue).
    emptyStreak = 0;

    // --- Parse ---
    const cleaned = stripCodeFences(rawText);
    let parsed: unknown;
    try {
      parsed = spec.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempt.kind = "retry-parse";
      attempt.failure = `parse: ${msg}`;
      attempts.push(attempt);
      deps.logger.warn(
        { stage: spec.name, attempt: n, parse_error: msg, preview: attempt.outputPreview },
        "stage output failed to parse; retrying with correction",
      );
      if (n >= maxAttempts) {
        throw new StageError(
          `Stage ${spec.name}: model output failed to parse across ${maxAttempts} attempts. Last error: ${msg}`,
          spec.name,
          deps.sessionId,
          attempts,
        );
      }
      messages = [
        ...messages,
        { role: "assistant", content: rawText },
        {
          role: "user",
          content: `Your previous response failed to parse with error: ${msg}\nReturn corrected ${spec.responseFormat === "json" ? "JSON" : "output"} only. No prose, no code fences.`,
        },
      ];
      continue;
    }

    // --- Schema validation ---
    let validated: T;
    try {
      validated = spec.validate(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempt.kind = "retry-schema";
      attempt.failure = `schema: ${msg}`;
      attempts.push(attempt);
      deps.logger.warn(
        { stage: spec.name, attempt: n, schema_error: msg.slice(0, 500) },
        "stage output failed schema validation; retrying with correction",
      );
      if (n >= maxAttempts) {
        throw new StageError(
          `Stage ${spec.name}: model output failed schema validation across ${maxAttempts} attempts. Last error: ${msg.slice(0, 500)}`,
          spec.name,
          deps.sessionId,
          attempts,
        );
      }
      messages = [
        ...messages,
        { role: "assistant", content: rawText },
        {
          role: "user",
          content: `Your previous response did not match the schema. Validation error:\n${msg}\n\nReturn a corrected JSON object matching the schema. No other output.`,
        },
      ];
      continue;
    }

    // --- Semantic-empty early-accept ---
    // If the caller marked this validated output as a legitimate
    // "nothing to do" result (e.g., headless API with no user-facing
    // journey → skipped outcome, zero steps), skip further checks and
    // accept it. Prevents us from retrying a model that's correctly
    // telling us there's nothing to produce.
    if (spec.acceptSemanticEmpty?.(validated) === true) {
      attempts.push(attempt);
      const totalNeurons = attempts.reduce((s, a) => s + (a.neurons ?? 0), 0);
      const totalLatencyMs = attempts.reduce((s, a) => s + a.latencyMs, 0);
      deps.logger.info(
        { stage: spec.name, attempt: n, model: activeModel, accepted: "semantic_empty" },
        "stage accepted semantic-empty output without retry",
      );
      return { output: validated, attempts, totalNeurons, totalLatencyMs };
    }

    // --- Semantic validation (business rules) ---
    if (spec.semanticCheck) {
      const semantic = spec.semanticCheck(validated);
      if (!semantic.ok) {
        attempt.kind = "retry-semantic";
        attempt.failure = `semantic: ${semantic.violations.join("; ")}`;
        attempts.push(attempt);
        deps.logger.warn(
          { stage: spec.name, attempt: n, violations: semantic.violations },
          "stage output failed semantic checks; retrying with hints",
        );
        if (n >= maxAttempts) {
          throw new StageError(
            `Stage ${spec.name}: semantic checks failed across ${maxAttempts} attempts. Violations: ${semantic.violations.join("; ")}`,
            spec.name,
            deps.sessionId,
            attempts,
          );
        }
        messages = [
          ...messages,
          { role: "assistant", content: rawText },
          {
            role: "user",
            content: `Your previous response was structurally valid but had these issues:\n- ${semantic.violations.join("\n- ")}\n\nProduce a corrected response. Same format as before.`,
          },
        ];
        continue;
      }
    }

    // Success!
    attempts.push(attempt);
    const totalNeurons = attempts.reduce((s, a) => s + (a.neurons ?? 0), 0);
    const totalLatencyMs = attempts.reduce((s, a) => s + a.latencyMs, 0);
    deps.logger.info(
      {
        stage: spec.name,
        attempts: attempts.length,
        total_neurons: totalNeurons,
        total_latency_ms: totalLatencyMs,
        final: {
          input_tokens: attempt.inputTokens,
          output_tokens: attempt.outputTokens,
          neurons: attempt.neurons,
          latency_ms: attempt.latencyMs,
        },
      },
      "stage ok",
    );
    return { output: validated, attempts, totalNeurons, totalLatencyMs };
  }

  // Unreachable but keeps TS happy.
  throw new StageError(
    `Stage ${spec.name}: exhausted retries without a terminal condition (internal error).`,
    spec.name,
    deps.sessionId,
    attempts,
  );
}

// Convenience: standard JSON parse wrapped to match spec.parse signature.
export function jsonParse(raw: string): unknown {
  return JSON.parse(raw);
}

// Convenience: identity for text stages.
export function textParse(raw: string): string {
  return raw;
}

// Convenience: Zod-validate helper. Uses z.ZodTypeAny so schemas with
// `.default()` (differing input vs output types) work cleanly.
export function zodValidate<S extends z.ZodTypeAny>(schema: S): (parsed: unknown) => z.infer<S> {
  return (parsed: unknown) => schema.parse(parsed);
}
