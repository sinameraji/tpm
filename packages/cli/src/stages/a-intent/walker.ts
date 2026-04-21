import * as fs from "node:fs";
import * as path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".astro",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".pm",
  ".tpm",
  ".wrangler",
  ".pnpm-store",
  ".turbo",
  "vendor",
  ".bundle",
]);

const CODE_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
]);

export interface WalkedFile {
  absPath: string;
  relPath: string;
  ext: string;
  size: number;
}

export interface WalkOptions {
  maxFileBytes?: number;
  maxFiles?: number;
  extraIgnoreDirs?: string[];
}

export function* walkProject(root: string, opts: WalkOptions = {}): Generator<WalkedFile> {
  const maxBytes = opts.maxFileBytes ?? 256 * 1024;
  const maxFiles = opts.maxFiles ?? 10_000;
  const ignore = new Set([...IGNORE_DIRS, ...(opts.extraIgnoreDirs ?? [])]);

  let count = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        // .env.* and other dotfiles are either secrets or tooling — skip.
        if (entry.isDirectory()) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > maxBytes) continue;
      if (++count > maxFiles) return;
      yield { absPath: full, relPath: path.relative(root, full), ext, size: stat.size };
    }
  }
}

export function isCodeFile(ext: string): boolean {
  return CODE_EXTS.has(ext);
}
