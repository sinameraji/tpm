import { describe, it, expect } from "vitest";
import { WorkersAIGateway } from "./workers-ai.js";

describe("WorkersAIGateway (M2 stub)", () => {
  it("has name 'workers-ai'", () => {
    const g = new WorkersAIGateway({ endpoint: "https://api.usetpm.dev/infer" });
    expect(g.name).toBe("workers-ai");
  });

  it("throws on complete() until M4 wires the proxy", async () => {
    const g = new WorkersAIGateway({ endpoint: "https://api.usetpm.dev/infer" });
    await expect(g.complete("@cf/openai/gpt-oss-120b", [])).rejects.toThrow(/M4/);
  });
});
