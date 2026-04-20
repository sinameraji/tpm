import { describe, it, expect } from "vitest";
import { buildProgram } from "./index.js";

describe("cli entry", () => {
  it("registers the OSS command set (no Stripe commands)", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(
      ["audit", "config", "cost", "feedback", "init", "report", "self-host"].sort(),
    );
  });

  it("aliases upgrade / activate / account to self-host", () => {
    const program = buildProgram();
    const selfHost = program.commands.find((c) => c.name() === "self-host");
    expect(selfHost).toBeDefined();
    expect(selfHost?.aliases()).toEqual(expect.arrayContaining(["upgrade", "activate", "account"]));
  });

  it("does not register `chat` (v2-only per spec)", () => {
    const program = buildProgram();
    expect(program.commands.map((c) => c.name())).not.toContain("chat");
  });

  it("declares the documented global flags", () => {
    const program = buildProgram();
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain("--json");
    expect(longs).toContain("--verbose");
    expect(longs).toContain("--session-id");
  });
});
