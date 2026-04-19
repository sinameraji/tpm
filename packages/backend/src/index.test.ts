import { describe, it, expect } from "vitest";
import worker from "./index.js";
import type { Env } from "./env.js";
import { baseEnv, makeD1, mockCtx, STUB_JWT_SECRET } from "./test-utils/d1-shim.js";
import { issueAccessToken } from "./lib/jwt.js";

function makeEnv(extras: Record<string, unknown> = {}): Env {
  const { d1 } = makeD1();
  return baseEnv({ DB: d1, ...extras }) as unknown as Env;
}

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "a".repeat(64);

describe("backend — health + 404", () => {
  it("GET /health → 200 ok", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://api.usetpm.dev/health"), env, mockCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.env).toBe("test");
  });

  it("GET /unknown → 404 not_found", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://api.usetpm.dev/unknown"), env, mockCtx());
    expect(res.status).toBe(404);
  });
});

describe("backend — /device/register", () => {
  it("accepts a well-formed device_id and returns access + refresh tokens", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://api.usetpm.dev/device/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          fingerprint_hash: FINGERPRINT,
          tpm_version: "0.0.0",
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mode: string;
      access_token: string;
      refresh_token: string;
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("hosted_trial");
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(body.refresh_token.split(".")).toHaveLength(3);
  });

  it("rejects a non-uuid device_id", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://api.usetpm.dev/device/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: "not-a-uuid",
          fingerprint_hash: FINGERPRINT,
          tpm_version: "0.0.0",
        }),
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(400);
  });

  it("is idempotent — second register updates rather than duplicates the device row", async () => {
    const env = makeEnv();
    const body = {
      device_id: DEVICE_ID,
      fingerprint_hash: FINGERPRINT,
      tpm_version: "0.0.0",
    };
    const hit = () =>
      worker.fetch(
        new Request("https://api.usetpm.dev/device/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        mockCtx(),
      );
    await hit();
    await hit();
    const count = await (
      env.DB as unknown as {
        prepare: (s: string) => {
          bind: (...a: unknown[]) => { first: <T>() => Promise<T | null> };
        };
      }
    )
      .prepare("SELECT COUNT(*) as c FROM devices WHERE id = ?")
      .bind(DEVICE_ID)
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });
});

describe("backend — /license/validate", () => {
  it("401 without a bearer token", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://api.usetpm.dev/license/validate"),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(401);
  });

  it("200 with quota shape when authed", async () => {
    const env = makeEnv();
    // register first so there's a license row
    await worker.fetch(
      new Request("https://api.usetpm.dev/device/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          fingerprint_hash: FINGERPRINT,
          tpm_version: "0.0.0",
        }),
      }),
      env,
      mockCtx(),
    );
    const token = await issueAccessToken(DEVICE_ID, STUB_JWT_SECRET);
    const res = await worker.fetch(
      new Request("https://api.usetpm.dev/license/validate", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mode: string;
      limit: number;
      used: number;
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("hosted_trial");
    expect(body.limit).toBe(1);
  });
});
