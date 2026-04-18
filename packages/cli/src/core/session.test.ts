import { describe, it, expect } from "vitest";
import { newSession } from "./session.js";

describe("newSession", () => {
  it("returns a v4 uuid and an iso timestamp", () => {
    const s = newSession();
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(() => new Date(s.startedAt).toISOString()).not.toThrow();
  });

  it("honors override", () => {
    expect(newSession("custom-id").id).toBe("custom-id");
  });

  it("generates distinct ids across calls", () => {
    const a = newSession();
    const b = newSession();
    expect(a.id).not.toBe(b.id);
  });
});
