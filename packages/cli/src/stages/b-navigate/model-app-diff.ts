// Deterministic structural diff between two ModelerOutputs.
//
// When two modelers agree, we pass the claim through. When they
// disagree, the synthesizer needs three things:
// 1. the claim itself, short and readable,
// 2. what each modeler said,
// 3. the file excerpts that could resolve the dispute.
//
// We don't do semantic fuzzy matching here — two models labeling the
// same wall "auth_wall" vs "authentication_wall" count as a
// disagreement on purpose, and the synthesizer normalizes. This keeps
// the diff honest and easy to audit.

import type { ModelerOutput } from "@tpm/shared/schemas/app-model";
import type { RequestedFile } from "./classify-project-prompt.js";

export interface Dispute {
  // What's being disputed, in product terms.
  claim: string;
  modeler_a_said: unknown;
  modeler_b_said: unknown;
  // File paths referenced by EITHER modeler's claim — the excerpts
  // for the synthesizer to read.
  file_paths: string[];
}

export interface DiffResult {
  agreed: {
    entry_points: ModelerOutput["entry_points"];
    walls: ModelerOutput["walls"];
    screens: ModelerOutput["screens"];
    navigation_graph: ModelerOutput["navigation_graph"];
  };
  disputes: Dispute[];
}

function keyOfEntry(e: ModelerOutput["entry_points"][number]): string {
  return `${e.kind_label}|${e.file_path}`;
}
function keyOfWall(w: ModelerOutput["walls"][number]): string {
  return `${w.type_label}|${w.file_path}`;
}
function keyOfScreen(s: ModelerOutput["screens"][number]): string {
  return `${s.title}|${s.file_path}`;
}
function keyOfTransition(t: ModelerOutput["navigation_graph"][number]): string {
  return `${t.from_screen}|${t.trigger}|${t.to_screen ?? "<null>"}`;
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}

export function diffAppModels(a: ModelerOutput, b: ModelerOutput): DiffResult {
  const disputes: Dispute[] = [];

  // --- Entry points ---
  const aEntries = new Map(a.entry_points.map((e) => [keyOfEntry(e), e] as const));
  const bEntries = new Map(b.entry_points.map((e) => [keyOfEntry(e), e] as const));
  const entryAgreed: ModelerOutput["entry_points"] = [];
  for (const [k, ea] of aEntries) {
    const eb = bEntries.get(k);
    if (
      eb &&
      shallowEqual(
        ea as unknown as Record<string, unknown>,
        eb as unknown as Record<string, unknown>,
      )
    ) {
      entryAgreed.push(ea);
    } else if (eb) {
      disputes.push({
        claim: `entry_point ${k} — fields differ`,
        modeler_a_said: ea,
        modeler_b_said: eb,
        file_paths: [ea.file_path, eb.file_path].filter((x, i, arr) => arr.indexOf(x) === i),
      });
    } else {
      disputes.push({
        claim: `entry_point ${k} — present in A, missing in B`,
        modeler_a_said: ea,
        modeler_b_said: null,
        file_paths: [ea.file_path],
      });
    }
  }
  for (const [k, eb] of bEntries) {
    if (!aEntries.has(k)) {
      disputes.push({
        claim: `entry_point ${k} — present in B, missing in A`,
        modeler_a_said: null,
        modeler_b_said: eb,
        file_paths: [eb.file_path],
      });
    }
  }

  // --- Walls ---
  const aWalls = new Map(a.walls.map((w) => [keyOfWall(w), w] as const));
  const bWalls = new Map(b.walls.map((w) => [keyOfWall(w), w] as const));
  const wallAgreed: ModelerOutput["walls"] = [];
  for (const [k, wa] of aWalls) {
    const wb = bWalls.get(k);
    if (
      wb &&
      shallowEqual(
        wa as unknown as Record<string, unknown>,
        wb as unknown as Record<string, unknown>,
      )
    ) {
      wallAgreed.push(wa);
    } else if (wb) {
      disputes.push({
        claim: `wall ${k} — fields differ`,
        modeler_a_said: wa,
        modeler_b_said: wb,
        file_paths: [wa.file_path, wb.file_path].filter((x, i, arr) => arr.indexOf(x) === i),
      });
    } else {
      disputes.push({
        claim: `wall ${k} — present in A, missing in B`,
        modeler_a_said: wa,
        modeler_b_said: null,
        file_paths: [wa.file_path],
      });
    }
  }
  for (const [k, wb] of bWalls) {
    if (!aWalls.has(k)) {
      disputes.push({
        claim: `wall ${k} — present in B, missing in A`,
        modeler_a_said: null,
        modeler_b_said: wb,
        file_paths: [wb.file_path],
      });
    }
  }

  // --- Screens ---
  const aScreens = new Map(a.screens.map((s) => [keyOfScreen(s), s] as const));
  const bScreens = new Map(b.screens.map((s) => [keyOfScreen(s), s] as const));
  const screenAgreed: ModelerOutput["screens"] = [];
  for (const [k, sa] of aScreens) {
    const sb = bScreens.get(k);
    if (
      sb &&
      shallowEqual(
        sa as unknown as Record<string, unknown>,
        sb as unknown as Record<string, unknown>,
      )
    ) {
      screenAgreed.push(sa);
    } else if (sb) {
      disputes.push({
        claim: `screen ${k} — fields differ`,
        modeler_a_said: sa,
        modeler_b_said: sb,
        file_paths: [sa.file_path, sb.file_path].filter((x, i, arr) => arr.indexOf(x) === i),
      });
    } else {
      disputes.push({
        claim: `screen ${k} — present in A, missing in B`,
        modeler_a_said: sa,
        modeler_b_said: null,
        file_paths: [sa.file_path],
      });
    }
  }
  for (const [k, sb] of bScreens) {
    if (!aScreens.has(k)) {
      disputes.push({
        claim: `screen ${k} — present in B, missing in A`,
        modeler_a_said: null,
        modeler_b_said: sb,
        file_paths: [sb.file_path],
      });
    }
  }

  // --- Transitions ---
  const aTr = new Map(a.navigation_graph.map((t) => [keyOfTransition(t), t] as const));
  const bTr = new Map(b.navigation_graph.map((t) => [keyOfTransition(t), t] as const));
  const trAgreed: ModelerOutput["navigation_graph"] = [];
  for (const [k, ta] of aTr) {
    const tb = bTr.get(k);
    if (
      tb &&
      shallowEqual(
        ta as unknown as Record<string, unknown>,
        tb as unknown as Record<string, unknown>,
      )
    ) {
      trAgreed.push(ta);
    } else if (tb) {
      disputes.push({
        claim: `transition ${k} — fields differ`,
        modeler_a_said: ta,
        modeler_b_said: tb,
        file_paths: [ta.handler_file, tb.handler_file].filter(
          (x): x is string => typeof x === "string",
        ),
      });
    } else {
      disputes.push({
        claim: `transition ${k} — present in A, missing in B`,
        modeler_a_said: ta,
        modeler_b_said: null,
        file_paths: ta.handler_file ? [ta.handler_file] : [],
      });
    }
  }
  for (const [k, tb] of bTr) {
    if (!aTr.has(k)) {
      disputes.push({
        claim: `transition ${k} — present in B, missing in A`,
        modeler_a_said: null,
        modeler_b_said: tb,
        file_paths: tb.handler_file ? [tb.handler_file] : [],
      });
    }
  }

  return {
    agreed: {
      entry_points: entryAgreed,
      walls: wallAgreed,
      screens: screenAgreed,
      navigation_graph: trAgreed,
    },
    disputes,
  };
}

// Extract the 10-20 line spans from seed files that a dispute references.
// We keep the whole file for now (already capped at 300 lines); the
// prompt orients the synthesizer with a file_path + the file's content.
// If cost pressure emerges we can slice more aggressively later.
export interface DisputeExcerpt {
  claim: string;
  modeler_a_said: unknown;
  modeler_b_said: unknown;
  file_excerpts: Array<{ path: string; content: string }>;
}

export function extractDisputeExcerpts(
  disputes: Dispute[],
  seedFiles: RequestedFile[],
): DisputeExcerpt[] {
  const byPath = new Map(seedFiles.map((f) => [f.path, f] as const));
  return disputes.map((d) => ({
    claim: d.claim,
    modeler_a_said: d.modeler_a_said,
    modeler_b_said: d.modeler_b_said,
    file_excerpts: d.file_paths
      .map((p) => {
        const f = byPath.get(p);
        return f ? { path: f.path, content: f.content } : null;
      })
      .filter((x): x is { path: string; content: string } => x !== null),
  }));
}
