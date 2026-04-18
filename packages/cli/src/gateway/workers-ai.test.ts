import { describe, it, expect } from "vitest";
import { WorkersAIGateway } from "./workers-ai.js";

describe("WorkersAIGateway (M2 stub)", () => {
  it("has name 'workers-ai'", () => {
    const g = new WorkersAIGateway({ endpoint: "https://api.usetpm.dev/infer" });
    expect(g.name).toBe("workers-ai");
  });

  it("calls /device/register then /infer, persisting tokens and returning usage", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-wa-"));

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      calls.push({ url, init });
      if (url.endsWith("/device/register")) {
        return new Response(
          JSON.stringify({
            ok: true,
            device_id: "d",
            tier: "free",
            access_token: "acc",
            refresh_token: "ref",
            expires_in: 60 * 60 * 24,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/infer")) {
        return new Response(
          JSON.stringify({
            ok: true,
            call_id: "c1",
            model: "@cf/openai/gpt-oss-120b",
            text: "hello",
            usage: { input_tokens: 10, output_tokens: 5, neurons: 0.15, latency_ms: 42 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    };

    const g = new WorkersAIGateway({
      endpoint: "https://api.usetpm.dev",
      fetchImpl,
      homeDir: home,
    });
    const out = await g.complete("@cf/openai/gpt-oss-120b", [{ role: "user", content: "hi" }], {
      stage: "A",
      auditId: "a1",
      sessionId: "s1",
    });
    expect(out.text).toBe("hello");
    expect(out.usage.inputTokens).toBe(10);
    expect(out.usage.outputTokens).toBe(5);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.usetpm.dev/device/register",
      "https://api.usetpm.dev/infer",
    ]);
    // Tokens persisted
    const tokens = JSON.parse(fs.readFileSync(path.join(home, ".tpm", "tokens.json"), "utf8"));
    expect(tokens.access_token).toBe("acc");
  });
});
