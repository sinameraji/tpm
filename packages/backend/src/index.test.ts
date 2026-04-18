import { describe, it, expect } from "vitest";
import worker from "./index.js";

function mockCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe("backend worker (M1 scaffold)", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const req = new Request("https://api.usetpm.dev/health");
    const res = await worker.fetch(req, {}, mockCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
  });

  it("GET /unknown → 404", async () => {
    const req = new Request("https://api.usetpm.dev/unknown");
    const res = await worker.fetch(req, {}, mockCtx());
    expect(res.status).toBe(404);
  });
});
