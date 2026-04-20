import { describe, expect, it, vi } from "vitest";
import { AnthropicGateway } from "./anthropic.js";
import type { Message } from "./index.js";

// Minimal shape that looks enough like SDK errors for `instanceof` to
// work. The real SDK's error classes chain through AnthropicError ->
// APIError; we mirror the class hierarchy locally for the translate
// path tests.
// NOTE: anthropic.ts imports error classes from the real SDK, and
// uses `instanceof` to pick a branch. For these tests we use the
// real SDK classes via `vi.mock` so thrown errors match.

type MockStream = {
  on: (event: string, listener: (delta: string, snapshot?: string) => void) => MockStream;
  finalMessage: () => Promise<{
    content: Array<{ type: "text"; text: string } | { type: string }>;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
  }>;
};

function buildMockStream(
  text: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  model = "claude-sonnet-4-6",
): MockStream {
  const listeners: Record<string, Array<(d: string, s?: string) => void>> = {};
  const s: MockStream = {
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return s;
    },
    async finalMessage() {
      // Fire the text deltas before finalMessage resolves so the
      // caller's onToken hooks see realistic streaming.
      const chunks = text.match(/.{1,32}/g) ?? [];
      for (const c of chunks) {
        listeners.text?.forEach((fn) => fn(c, text));
      }
      return {
        content: [{ type: "text", text }],
        model,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
        },
      };
    },
  };
  return s;
}

// Construct a gateway with a stubbed SDK client. We reach into the
// private `client` field via a cast — an integration-style test would
// mock the real SDK module, but for the translate/stream-shape tests
// that's more machinery than the behavior needs.
function gatewayWithStub(stub: {
  stream?: (params: unknown) => MockStream;
  streamThrows?: unknown;
}) {
  const g = new AnthropicGateway({ apiKey: "sk-ant-test" });
  // @ts-expect-error — overriding the private client with a minimal stub
  g.client = {
    messages: {
      stream: (params: unknown) => {
        if (stub.streamThrows) throw stub.streamThrows;
        return stub.stream!(params);
      },
    },
  };
  return g;
}

describe("AnthropicGateway", () => {
  describe("complete()", () => {
    it("returns text + usage including cache fields", async () => {
      const g = gatewayWithStub({
        stream: () =>
          buildMockStream("hello world", {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
          }),
      });
      const msgs: Message[] = [
        { role: "system", content: "you are a helpful model" },
        { role: "user", content: "hi" },
      ];
      const res = await g.complete("claude-sonnet-4-6", msgs, { maxTokens: 100 });
      expect(res.text).toBe("hello world");
      expect(res.model).toBe("claude-sonnet-4-6");
      expect(res.usage.inputTokens).toBe(100);
      expect(res.usage.outputTokens).toBe(50);
      expect(res.usage.cacheReadInputTokens).toBe(40);
      expect(res.usage.cacheCreationInputTokens).toBe(10);
      expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("extracts the first system message into the `system` param (string form when not cached)", async () => {
      let seen: { system?: unknown; messages?: Array<{ role: string; content: unknown }> } = {};
      const g = gatewayWithStub({
        stream: (params) => {
          seen = params as typeof seen;
          return buildMockStream("ok", { input_tokens: 1, output_tokens: 1 });
        },
      });
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: "SYS" },
          { role: "user", content: "hi" },
        ],
        {},
      );
      expect(seen.system).toBe("SYS");
      expect(seen.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("attaches cache_control ONLY when cacheSystem is true AND system is long enough", async () => {
      let seen: { system?: unknown } = {};
      const g = gatewayWithStub({
        stream: (params) => {
          seen = params as typeof seen;
          return buildMockStream("ok", { input_tokens: 1, output_tokens: 1 });
        },
      });
      // Short system: cacheSystem: true but below the 1024-token floor
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: "short system" },
          { role: "user", content: "hi" },
        ],
        { cacheSystem: true },
      );
      expect(seen.system).toBe("short system");

      // Long system: ~4000 chars ≈ 1400 tokens > floor
      const longSystem = "x".repeat(4000);
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: longSystem },
          { role: "user", content: "hi" },
        ],
        { cacheSystem: true },
      );
      expect(seen.system).toEqual([
        {
          type: "text",
          text: longSystem,
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("never attaches cache_control when cacheSystem is false (default)", async () => {
      let seen: { system?: unknown } = {};
      const g = gatewayWithStub({
        stream: (params) => {
          seen = params as typeof seen;
          return buildMockStream("ok", { input_tokens: 1, output_tokens: 1 });
        },
      });
      const longSystem = "x".repeat(4000);
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: longSystem },
          { role: "user", content: "hi" },
        ],
        {},
      );
      expect(seen.system).toBe(longSystem);
    });

    it("appends JSON instruction to last user message when responseFormat=json", async () => {
      let seen: { messages?: Array<{ role: string; content: string }> } = {};
      const g = gatewayWithStub({
        stream: (params) => {
          seen = params as typeof seen;
          return buildMockStream('{"ok":true}', { input_tokens: 1, output_tokens: 1 });
        },
      });
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: "SYS" },
          { role: "user", content: "do the thing" },
        ],
        { responseFormat: "json" },
      );
      expect(seen.messages?.[0]?.content).toContain("do the thing");
      expect(seen.messages?.[0]?.content).toMatch(/JSON object/i);
      expect(seen.messages?.[0]?.content).toMatch(/no code fences/i);
    });

    it("does not append JSON instruction when responseFormat=text", async () => {
      let seen: { messages?: Array<{ role: string; content: string }> } = {};
      const g = gatewayWithStub({
        stream: (params) => {
          seen = params as typeof seen;
          return buildMockStream("plain", { input_tokens: 1, output_tokens: 1 });
        },
      });
      await g.complete(
        "claude-sonnet-4-6",
        [
          { role: "system", content: "SYS" },
          { role: "user", content: "do the thing" },
        ],
        { responseFormat: "text" },
      );
      expect(seen.messages?.[0]?.content).toBe("do the thing");
    });

    it("fires onToken with cumulative output count during streaming", async () => {
      const g = gatewayWithStub({
        stream: () =>
          buildMockStream(
            "a".repeat(128), // will be chunked into 4 × 32-char deltas in the mock
            { input_tokens: 1, output_tokens: 32 },
          ),
      });
      const onToken = vi.fn();
      await g.complete("claude-sonnet-4-6", [{ role: "user", content: "go" }], { onToken });
      expect(onToken).toHaveBeenCalled();
      const lastCall = onToken.mock.calls.at(-1)?.[0] as number;
      // Monotonic and > 0.
      expect(lastCall).toBeGreaterThan(0);
      // Each call's value is ≥ the previous one.
      let prev = 0;
      for (const call of onToken.mock.calls) {
        const n = call[0] as number;
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    });
  });

  describe("error translation", () => {
    it("wraps 401 with a key-actionable message", async () => {
      const { AuthenticationError } = await import("@anthropic-ai/sdk");
      const g = gatewayWithStub({
        streamThrows: new AuthenticationError(401, {}, "bad key", new Headers()),
      });
      await expect(
        g.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/Anthropic rejected the API key/);
    });

    it("wraps 429 with a rate-limit message", async () => {
      const { RateLimitError } = await import("@anthropic-ai/sdk");
      const g = gatewayWithStub({
        streamThrows: new RateLimitError(429, {}, "slow down", new Headers()),
      });
      await expect(
        g.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/rate limit/i);
    });

    it("flags context-too-large on 400 with token/context phrasing", async () => {
      const { BadRequestError } = await import("@anthropic-ai/sdk");
      // SDK's APIError builds its message from the response body's
      // `message` field — mirror that shape so the message reads
      // realistically ("400 prompt is too long: ...").
      const g = gatewayWithStub({
        streamThrows: new BadRequestError(
          400,
          { message: "prompt is too long: 250000 tokens > 200000" },
          undefined,
          new Headers(),
        ),
      });
      await expect(
        g.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/exceeds context window/i);
    });

    it("labels 529 as overloaded / retryable", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const g = gatewayWithStub({
        streamThrows: new APIError(529, {}, "overloaded", new Headers()),
      });
      await expect(
        g.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/overloaded/i);
    });
  });
});
