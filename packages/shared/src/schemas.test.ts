import { describe, it, expect } from "vitest";
import {
  LeanCanvas,
  Paths,
  Delta,
  Problems,
  Solutions,
  Patterns,
  Config,
  License,
} from "./index.js";

describe("schema stubs — every stage schema exposes schema_version=1 and parses", () => {
  const cases = [
    ["lean-canvas", LeanCanvas.LeanCanvasSchema, LeanCanvas.SCHEMA_VERSION],
    ["paths", Paths.PathsSchema, Paths.SCHEMA_VERSION],
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
