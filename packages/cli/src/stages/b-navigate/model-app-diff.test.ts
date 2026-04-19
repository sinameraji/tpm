import { describe, it, expect } from "vitest";
import type { ModelerOutput } from "@tpm/shared/schemas/app-model";
import { diffAppModels, extractDisputeExcerpts } from "./model-app-diff.js";

function baseOutput(overrides: Partial<ModelerOutput> = {}): ModelerOutput {
  return {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    models: ["test-model"],
    profile: {
      schema_version: 1,
      description: "A small test app for verifying the diff algorithm — enough chars to pass.",
      candidate_entry_points: [{ file_path: "main.ts", rationale: "entry" }],
      candidate_screen_files: [],
      confidence: "high",
      unknowns: [],
    },
    entry_points: [
      {
        id: "E001",
        kind_label: "main process",
        file_path: "main.ts",
        opens_screen_id: "S001",
        notes: "n",
      },
    ],
    walls: [],
    screens: [
      {
        id: "S001",
        title: "Home",
        file_path: "Home.tsx",
        is_entry: true,
        gated_by_walls: [],
        visible_elements: [],
        known_unknowns: [],
      },
    ],
    navigation_graph: [],
    known_unknowns: [],
    seed_files_used: ["main.ts", "Home.tsx"],
    ...overrides,
  };
}

describe("diffAppModels", () => {
  it("identical outputs → no disputes", () => {
    const a = baseOutput();
    const b = baseOutput();
    const { agreed, disputes } = diffAppModels(a, b);
    expect(disputes).toEqual([]);
    expect(agreed.entry_points).toHaveLength(1);
    expect(agreed.screens).toHaveLength(1);
  });

  it("surfaces screens that differ in one field", () => {
    const a = baseOutput();
    const b = baseOutput({
      screens: [
        {
          ...baseOutput().screens[0]!,
          title: "Dashboard", // different title
        },
      ],
    });
    const { disputes } = diffAppModels(a, b);
    // different titles → different keys → "missing in B" + "missing in A"
    expect(disputes).toHaveLength(2);
    expect(disputes.some((d) => d.claim.includes("Home"))).toBe(true);
    expect(disputes.some((d) => d.claim.includes("Dashboard"))).toBe(true);
  });

  it("surfaces walls present only in one side", () => {
    const a = baseOutput({
      walls: [
        {
          id: "W001",
          type_label: "auth wall",
          blocks_screens: ["S002"],
          bypass_condition: null,
          redirect_on_success: null,
          file_path: "auth.ts",
          evidence: "if (!user) redirect",
        },
      ],
    });
    const b = baseOutput();
    const { disputes } = diffAppModels(a, b);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]?.claim).toMatch(/wall .* present in A, missing in B/);
    expect(disputes[0]?.file_paths).toContain("auth.ts");
  });

  it("surfaces transitions that differ", () => {
    const a = baseOutput({
      navigation_graph: [
        {
          id: "T001",
          from_screen: "S001",
          trigger: "click 'Go'",
          to_screen: "S002",
          handler_file: "Home.tsx",
          is_external: false,
        },
      ],
    });
    const b = baseOutput({
      navigation_graph: [
        {
          id: "T001",
          from_screen: "S001",
          trigger: "click 'Go'",
          to_screen: "S003", // different target
          handler_file: "Home.tsx",
          is_external: false,
        },
      ],
    });
    const { disputes } = diffAppModels(a, b);
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes.some((d) => d.claim.includes("transition"))).toBe(true);
  });
});

describe("extractDisputeExcerpts", () => {
  it("pulls file content for each disputed file_path", () => {
    const disputes = [
      {
        claim: "wall auth — missing in B",
        modeler_a_said: { id: "W001" },
        modeler_b_said: null,
        file_paths: ["auth.ts"],
      },
    ];
    const seed = [
      { path: "auth.ts", content: "if (!session) redirect('/login')" },
      { path: "other.ts", content: "export const x = 1;" },
    ];
    const excerpts = extractDisputeExcerpts(disputes, seed);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.file_excerpts).toHaveLength(1);
    expect(excerpts[0]?.file_excerpts[0]?.path).toBe("auth.ts");
    expect(excerpts[0]?.file_excerpts[0]?.content).toContain("redirect");
  });

  it("silently drops disputes whose files aren't in the seed set", () => {
    const disputes = [
      {
        claim: "phantom claim",
        modeler_a_said: {},
        modeler_b_said: {},
        file_paths: ["nonexistent.ts"],
      },
    ];
    const excerpts = extractDisputeExcerpts(disputes, []);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.file_excerpts).toEqual([]);
  });
});
