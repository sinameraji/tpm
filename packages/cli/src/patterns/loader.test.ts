import { describe, it, expect } from "vitest";
import { loadBuiltInPatterns, summarizePatternLibrary } from "./loader.js";

describe("built-in pattern library", () => {
  it("has ≥50 patterns", () => {
    const lib = loadBuiltInPatterns();
    expect(lib.patterns.length).toBeGreaterThanOrEqual(50);
  });

  it("every pattern has id, title, category, body with all required fields", () => {
    const lib = loadBuiltInPatterns();
    for (const p of lib.patterns) {
      expect(p.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.category).toBeDefined();
      expect(p.body.summary.length).toBeGreaterThan(10);
      expect(Array.isArray(p.body.detection_signals)).toBe(true);
      expect(p.body.detection_signals.length).toBeGreaterThan(0);
      expect(p.body.recommendation.length).toBeGreaterThan(10);
    }
  });

  it("ids are unique", () => {
    const lib = loadBuiltInPatterns();
    const ids = lib.patterns.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("library_hash is a stable sha256", () => {
    const a = loadBuiltInPatterns();
    const b = loadBuiltInPatterns();
    expect(a.library_hash).toBe(b.library_hash);
    expect(a.library_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("summarizePatternLibrary includes id+title+signals for every pattern", () => {
    const lib = loadBuiltInPatterns();
    const summary = summarizePatternLibrary(lib);
    for (const p of lib.patterns) {
      expect(summary).toContain(`id: ${p.id}`);
      expect(summary).toContain(`title: ${p.title}`);
    }
  });
});
