import { describe, it, expect } from "vitest";
import { buildProgram } from "./index.js";

describe("cli entry", () => {
  it("registers the v1.2.0 command set (BYO Anthropic)", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["audit", "config", "cost", "feedback", "init", "report"].sort());
  });

  it("does not register legacy commands removed in 1.2.0", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).not.toContain("self-host");
    expect(names).not.toContain("chat");
  });

  it("declares the documented global flags", () => {
    const program = buildProgram();
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain("--json");
    expect(longs).toContain("--verbose");
    expect(longs).toContain("--session-id");
  });
});
