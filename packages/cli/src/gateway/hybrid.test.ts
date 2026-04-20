import { describe, expect, it, vi } from "vitest";
import { HybridGateway, pickRoute } from "./hybrid.js";
import type { ModelGateway } from "./index.js";

function mockGateway(name: string): ModelGateway & {
  calls: Array<{ model: string }>;
} {
  const calls: Array<{ model: string }> = [];
  return {
    name,
    calls,
    complete: vi.fn(async (model: string) => {
      calls.push({ model });
      return {
        text: `from ${name}`,
        model,
        usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1 },
      };
    }),
  };
}

describe("pickRoute", () => {
  it("routes claude- prefix to anthropic", () => {
    expect(pickRoute("claude-sonnet-4-6")).toBe("anthropic");
    expect(pickRoute("claude-opus-4-7")).toBe("anthropic");
  });

  it("routes @cf/ prefix to workers-ai", () => {
    expect(pickRoute("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe("workers-ai");
  });

  it("falls back to defaultTo for unknown prefixes", () => {
    expect(pickRoute("gpt-4o", "anthropic")).toBe("anthropic");
    expect(pickRoute("gpt-4o", "workers-ai")).toBe("workers-ai");
  });
});

describe("HybridGateway", () => {
  it("dispatches claude- models to the anthropic gateway", async () => {
    const anthropic = mockGateway("anthropic");
    const workersAI = mockGateway("workers-ai");
    const hybrid = new HybridGateway({ anthropic, workersAI });
    const res = await hybrid.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]);
    expect(res.text).toBe("from anthropic");
    expect(anthropic.calls).toHaveLength(1);
    expect(workersAI.calls).toHaveLength(0);
  });

  it("dispatches @cf/ models to the workers-ai gateway", async () => {
    const anthropic = mockGateway("anthropic");
    const workersAI = mockGateway("workers-ai");
    const hybrid = new HybridGateway({ anthropic, workersAI });
    const res = await hybrid.complete("@cf/meta/llama-3.3-70b-instruct-fp8-fast", [
      { role: "user", content: "hi" },
    ]);
    expect(res.text).toBe("from workers-ai");
    expect(workersAI.calls).toHaveLength(1);
    expect(anthropic.calls).toHaveLength(0);
  });

  it("errors clearly when claude- routes but no Anthropic gateway is configured", async () => {
    const hybrid = new HybridGateway({
      anthropic: null,
      workersAI: mockGateway("workers-ai"),
    });
    await expect(
      hybrid.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/ANTHROPIC_API_KEY|tpm config set anthropic-key/);
  });

  it("errors clearly when @cf/ routes but no Workers AI gateway is configured", async () => {
    const hybrid = new HybridGateway({
      anthropic: mockGateway("anthropic"),
      workersAI: null,
    });
    await expect(
      hybrid.complete("@cf/meta/llama-3.3-70b-instruct-fp8-fast", [
        { role: "user", content: "hi" },
      ]),
    ).rejects.toThrow(/Workers AI/);
  });

  it("passes opts through unchanged", async () => {
    const anthropic = mockGateway("anthropic");
    const hybrid = new HybridGateway({
      anthropic,
      workersAI: mockGateway("workers-ai"),
    });
    const opts = {
      temperature: 0.2,
      maxTokens: 100,
      auditId: "a-1",
      sessionId: "s-1",
      cacheSystem: true,
    };
    await hybrid.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }], opts);
    expect(anthropic.complete).toHaveBeenCalledWith(
      "claude-sonnet-4-6",
      [{ role: "user", content: "hi" }],
      opts,
    );
  });
});
