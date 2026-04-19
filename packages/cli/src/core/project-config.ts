import * as fs from "node:fs";
import yaml from "js-yaml";
import { projectPaths, ensureDir } from "./paths.js";

export interface ProjectConfig {
  schema_version: 1;
  project_path: string;
  // Optional marketing/landing URL. Auxiliary evidence only — the
  // primary source of truth is the codebase. User can set via
  //   tpm audit --marketing-url https://...
  // or interactively at audit time, or leave blank entirely.
  marketing_url?: string;
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
