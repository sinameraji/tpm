import * as fs from "node:fs";
import yaml from "js-yaml";
import { projectPaths, ensureDir } from "./paths.js";

export interface ProjectConfig {
  schema_version: 1;
  project_path: string;
}

export function loadProjectConfig(projectRoot: string = process.cwd()): ProjectConfig | null {
  const p = projectPaths(projectRoot).configYaml;
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = yaml.load(raw) as Partial<ProjectConfig> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      schema_version: 1,
      project_path: parsed.project_path ?? projectRoot,
    };
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
