import { describe, it, expect } from "vitest";
import {
  Paths,
  Delta,
  Problems,
  Solutions,
  Patterns,
  Config,
  License,
  LeanCanvas,
} from "./index.js";

describe("schema stubs — every stage schema exposes schema_version=1 and parses", () => {
  // Stubs still carry just schema_version. The filled-in schemas (lean-canvas,
  // paths) have dedicated tests in their stage packages; this test only asserts
  // the SCHEMA_VERSION constant is pinned at 1 for every pipeline artifact.
  const cases = [
    ["delta", Delta.DeltaSchema, Delta.SCHEMA_VERSION],
    ["problems", Problems.ProblemsSchema, Problems.SCHEMA_VERSION],
    ["solutions", Solutions.SolutionsSchema, Solutions.SCHEMA_VERSION],
    ["patterns", Patterns.PatternsSchema, Patterns.SCHEMA_VERSION],
    ["config", Config.ConfigSchema, Config.SCHEMA_VERSION],
    ["license", License.LicenseSchema, License.SCHEMA_VERSION],
  ] as const;

  for (const [name, schema, version] of cases) {
    it(`${name}: parses minimal {schema_version: ${version}}`, () => {
      expect(version).toBe(1);
      const parsed = schema.parse({ schema_version: version });
      expect(parsed.schema_version).toBe(version);
    });

    it(`${name}: rejects wrong schema_version`, () => {
      expect(() => schema.parse({ schema_version: 999 })).toThrow();
    });
  }
});

describe("SCHEMA_VERSION constants across all stage schemas", () => {
  it("all pipeline artifacts pin schema_version at 1", () => {
    expect(LeanCanvas.SCHEMA_VERSION).toBe(1);
    expect(Paths.SCHEMA_VERSION).toBe(1);
    expect(Delta.SCHEMA_VERSION).toBe(1);
    expect(Problems.SCHEMA_VERSION).toBe(1);
    expect(Solutions.SCHEMA_VERSION).toBe(1);
    expect(Patterns.SCHEMA_VERSION).toBe(1);
    expect(Config.SCHEMA_VERSION).toBe(1);
    expect(License.SCHEMA_VERSION).toBe(1);
  });
});

describe("fixed enums — pipeline classification taxonomies", () => {
  it("paths: friction flag taxonomy has the 12 flags from spec", () => {
    const expected = [
      "premature_data_collection",
      "required_without_rationale",
      "blank_page_anxiety",
      "forced_tour",
      "configuration_theater",
      "verification_before_value",
      "intent_mismatch",
      "dead_end",
      "fork_without_signal",
      "cycle_detected",
      "orphan_state",
      "missing_affordance",
    ];
    expect(Paths.FrictionFlagType.options).toEqual(expected);
  });

  it("delta: step classification has the 7 classes from spec", () => {
    const expected = [
      "necessary",
      "cuttable",
      "cuttable_with_care",
      "intentional_friction_working",
      "intentional_friction_broken",
      "cargo_culted",
      "broken",
    ];
    expect(Delta.StepClassification.options).toEqual(expected);
  });
});
