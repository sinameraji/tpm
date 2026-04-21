import * as fs from "node:fs";
import yaml from "js-yaml";
import { projectPaths, ensureDir } from "./paths.js";

// Product-stage context set at init or first audit. Changes how Stage A
// extracts intent and how Stage F frames the report. Without this,
// TPM defaulted to "distributable product" and invented target personas
// from code — see the beta.11 fix note in CHANGELOG for the specific
// failure mode that drove adding this field.
//
// Values map to prompt preambles in Stage A + Stage F (see core/product-
// context.ts). "other" stores the user's free-form description verbatim.
export type ProductContextKind =
  | "personal" // a tool the developer uses themselves
  | "internal" // a tool for a known team / org
  | "distributable" // a product aimed at external users
  | "wip" // work in progress, partially implemented, not yet done
  | "other"; // user-described

export interface ProductContext {
  kind: ProductContextKind;
  // Free-form user-supplied description. Required when kind=other;
  // optional otherwise (the kind alone is usually enough grounding).
  note?: string;
}

export interface ProjectConfig {
  schema_version: 1;
  project_path: string;
  // Optional marketing/landing URL. Auxiliary evidence only — the
  // primary source of truth is the codebase. User can set via
  //   tpm audit --marketing-url https://...
  // or interactively at audit time, or leave blank entirely.
  marketing_url?: string;
  product_context?: ProductContext;
}

function parseProductContext(raw: unknown): ProductContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { kind?: unknown; note?: unknown };
  const kind = r.kind;
  if (
    kind !== "personal" &&
    kind !== "internal" &&
    kind !== "distributable" &&
    kind !== "wip" &&
    kind !== "other"
  ) {
    return undefined;
  }
  const out: ProductContext = { kind };
  if (typeof r.note === "string" && r.note.trim()) out.note = r.note.trim();
  return out;
}

export function loadProjectConfig(projectRoot: string = process.cwd()): ProjectConfig | null {
  const p = projectPaths(projectRoot).configYaml;
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = yaml.load(raw) as Partial<ProjectConfig> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const cfg: ProjectConfig = {
      schema_version: 1,
      project_path: parsed.project_path ?? projectRoot,
    };
    if (parsed.marketing_url) cfg.marketing_url = parsed.marketing_url;
    const ctx = parseProductContext(parsed.product_context);
    if (ctx) cfg.product_context = ctx;
    return cfg;
  } catch {
    return null;
  }
}

export function saveProjectConfig(cfg: ProjectConfig, projectRoot: string = process.cwd()): void {
  const paths = projectPaths(projectRoot);
  ensureDir(paths.root, 0o755);
  fs.writeFileSync(paths.configYaml, yaml.dump(cfg, { noRefs: true, lineWidth: 120 }), {
    mode: 0o644,
  });
}
