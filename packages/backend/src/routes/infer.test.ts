import { describe, it, expect } from "vitest";
import worker from "../index.js";
import type { Env } from "../env.js";
import { baseEnv, makeD1, mockCtx, STUB_JWT_SECRET } from "../test-utils/d1-shim.js";
import { issueAccessToken } from "../lib/jwt.js";

const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

interface StubAiRun {
  response?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function aiStub(result: StubAiRun) {
  return {
    async run(): Promise<StubAiRun> {
      return result;
    },
  } as unknown as Ai;
}

async function registerDevice(env: Env): Promise<string> {
  await worker.fetch(
    new Request("https://tpm-api.sina-b35.workers.dev/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: DEVICE_ID,
        fingerprint_hash: "a".repeat(64),
        tpm_version: "0.0.0",
      }),
    }),
    env,
    mockCtx(),
  );
  return issueAccessToken(DEVICE_ID, STUB_JWT_SECRET);
}

describe("backend — /infer", () => {
  it("401 without auth", async () => {
    const { d1 } = makeD1();
    const env = baseEnv({ DB: d1, AI: aiStub({ response: "", usage: {} }) }) as unknown as Env;
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "@cf/openai/gpt-oss-120b",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(401);
  });

  it("400 on unsupported model", async () => {
    const { d1 } = makeD1();
    const env = baseEnv({ DB: d1, AI: aiStub({ response: "", usage: {} }) }) as unknown as Env;
    const token = await registerDevice(env);
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/infer", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: "evil-model",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(400);
  });

  it("happy path returns text + usage and writes usage_log", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({
      DB: d1,
      AI: aiStub({ response: "pong", usage: { prompt_tokens: 4, completion_tokens: 1 } }),
    }) as unknown as Env;
    const token = await registerDevice(env);
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/infer", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: "@cf/openai/gpt-oss-120b",
          messages: [{ role: "user", content: "ping" }],
          stage: "A",
          audit_id: "aud-1",
          session_id: "sess-1",
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; usage: { neurons: number } };
    expect(body.text).toBe("pong");
    expect(body.usage.neurons).toBeGreaterThan(0);

    const row = raw.prepare("SELECT stage, model, status, neurons FROM usage_log").get() as {
      stage: string;
      model: string;
      status: string;
      neurons: number;
    };
    expect(row.stage).toBe("A");
    expect(row.model).toBe("@cf/openai/gpt-oss-120b");
    expect(row.status).toBe("ok");
    expect(row.neurons).toBeGreaterThan(0);
  });

  it("402 when a SUCCEEDED audit already exists (trial burned)", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({
      DB: d1,
      AI: aiStub({ response: "x", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    }) as unknown as Env;
    const token = await registerDevice(env);
    raw
      .prepare(
        "INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, 'succeeded', 'hosted_trial', '1.0.0')",
      )
      .run("prior-audit", DEVICE_ID, "s", "/tmp/x", new Date().toISOString());
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/infer", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: "@cf/openai/gpt-oss-120b",
          messages: [{ role: "user", content: "hi" }],
          stage: "A",
          audit_id: "new-audit",
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(402);
  });

  it("does NOT 402 when only a FAILED audit exists", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({
      DB: d1,
      AI: aiStub({ response: "x", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    }) as unknown as Env;
    const token = await registerDevice(env);
    raw
      .prepare(
        "INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, 'failed', 'hosted_trial', '1.0.0')",
      )
      .run("prior-fail", DEVICE_ID, "s", "/tmp/x", new Date().toISOString());
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/infer", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: "@cf/openai/gpt-oss-120b",
          messages: [{ role: "user", content: "hi" }],
          stage: "A",
          audit_id: "retry-audit",
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
  });
});
