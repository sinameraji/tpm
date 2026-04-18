import { describe, it, expect } from "vitest";
import { buildProgram } from "./index.js";

describe("cli entry (M2)", () => {
  it("registers all v1 commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(
      ["account", "activate", "audit", "config", "cost", "init", "report", "upgrade"].sort(),
    );
  });

  it("does not register `chat` (v2-only per spec)", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
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
