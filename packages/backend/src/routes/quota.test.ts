import { describe, it, expect } from "vitest";
import worker from "../index.js";
import type { Env } from "../env.js";
import { baseEnv, makeD1, mockCtx, STUB_JWT_SECRET } from "../test-utils/d1-shim.js";
import { issueAccessToken } from "../lib/jwt.js";

const DEVICE_ID = "33333333-3333-4333-8333-333333333333";

async function register(env: Env): Promise<string> {
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

describe("/quota/check", () => {
  it("returns hosted-trial allowances when unused", async () => {
    const { d1 } = makeD1();
    const env = baseEnv({ DB: d1 }) as unknown as Env;
    const token = await register(env);
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/quota/check", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      limit: number;
      used: number;
      allowances: { full_audit: boolean };
      self_host: unknown;
    };
    expect(body.mode).toBe("hosted_trial");
    expect(body.limit).toBe(1);
    expect(body.used).toBe(0);
    expect(body.allowances.full_audit).toBe(true);
    expect(body.self_host).toBeNull();
  });

  it("flags full_audit=false + self_host link only after a SUCCEEDED audit exists", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({ DB: d1 }) as unknown as Env;
    const token = await register(env);
    // Seed a succeeded audit row (not just a usage_log entry).
    raw
      .prepare(
        "INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, 'succeeded', 'hosted_trial', '1.0.0')",
      )
      .run("aud-1", DEVICE_ID, "s", "/tmp/x", new Date().toISOString());
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/quota/check", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      mockCtx(),
    );
    const body = (await res.json()) as {
      allowances: { full_audit: boolean };
      self_host: { url: string } | null;
    };
    expect(body.allowances.full_audit).toBe(false);
    expect(body.self_host?.url).toContain("self-host");
  });

  it("whitelisted device bypasses the quota even after a succeeded audit", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({ DB: d1 }) as unknown as Env;
    const token = await register(env);
    raw.prepare("UPDATE devices SET is_whitelisted = 1 WHERE id = ?").run(DEVICE_ID);
    raw
      .prepare(
        "INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, 'succeeded', 'hosted_trial', '1.0.0')",
      )
      .run("aud-w1", DEVICE_ID, "s", "/tmp/x", new Date().toISOString());
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/quota/check", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      mockCtx(),
    );
    const body = (await res.json()) as {
      mode: string;
      allowances: { full_audit: boolean };
    };
    expect(body.mode).toBe("whitelisted");
    expect(body.allowances.full_audit).toBe(true);
  });

  it("does NOT count failed audits — trial remains available", async () => {
    const { d1, raw } = makeD1();
    const env = baseEnv({ DB: d1 }) as unknown as Env;
    const token = await register(env);
    // A failed audit attempt should NOT burn the trial.
    raw
      .prepare(
        "INSERT INTO audits (id, device_id, session_id, target, started_at, status, tier_at_run, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, 'failed', 'hosted_trial', '1.0.0')",
      )
      .run("aud-fail", DEVICE_ID, "s", "/tmp/x", new Date().toISOString());
    const res = await worker.fetch(
      new Request("https://tpm-api.sina-b35.workers.dev/quota/check", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      mockCtx(),
    );
    const body = (await res.json()) as {
      used: number;
      allowances: { full_audit: boolean };
    };
    expect(body.used).toBe(0);
    expect(body.allowances.full_audit).toBe(true);
  });
});
