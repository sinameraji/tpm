// Deterministic `ls`-style repo snapshot. NO classification, NO
// dependency scanning, NO opinions about what matters. Shows B-classify
// the shape of the project so the LLM can decide what files to read.
//
// Why deterministic: fetching file metadata (names, sizes, existence
// of well-known manifests) has no judgment calls. Classification does,
// and that's the LLM's job. This module is the `tree -L 3` step.

import * as fs from "node:fs";
import * as path from "node:path";

export interface SnapshotEntry {
  path: string; // relative to root
  kind: "file" | "dir";
  depth: number; // 0 = top-level
  size_bytes?: number;
}

export interface RepoSnapshot {
  root_path: string;
  top_level_entries: SnapshotEntry[];
  shallow_tree: SnapshotEntry[];
  manifest_presence: string[]; // well-known manifests that exist (not read)
  total_file_count: number;
  total_dir_count: number;
  truncated: boolean;
}

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
  "target",
  "Pods",
  "DerivedData",
]);

// Manifests we flag if present. Listed, not read. The classifier LLM
// decides which to actually request contents for.
const WELL_KNOWN_MANIFESTS = [
  "package.json",
  "pnpm-workspace.yaml",
  "lerna.json",
  "turbo.json",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "Pipfile",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "pubspec.yaml",
  "Podfile",
  "Package.swift",
  "mix.exs",
  "stack.yaml",
  "elm.json",
  "deno.json",
  "bun.lockb",
  "tauri.conf.json",
  "electron-builder.yml",
  "electron-builder.json",
  "electron.vite.config.ts",
  "electron.vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "remix.config.js",
  "app.json",
  "app.config.js",
  "app.config.ts",
  "metro.config.js",
  "babel.config.js",
  "tsconfig.json",
  "Dockerfile",
  "docker-compose.yml",
  "Makefile",
  "CMakeLists.txt",
  "Unity.csproj",
];

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 300;

export interface SnapshotOptions {
  maxDepth?: number;
  maxEntries?: number;
  followSymlinks?: boolean;
}

export function snapshotRepo(projectRoot: string, opts: SnapshotOptions = {}): RepoSnapshot {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const follow = opts.followSymlinks ?? false;

  const tree: SnapshotEntry[] = [];
  const topLevel: SnapshotEntry[] = [];
  let fileCount = 0;
  let dirCount = 0;
  let truncated = false;

  function walk(absDir: string, relDir: string, depth: number): void {
    if (truncated) return;
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    // Deterministic order: dirs first, then files, alpha within each.
    entries.sort((a, b) => {
      const aIsDir = a.isDirectory();
      const bIsDir = b.isDirectory();
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (tree.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".gitignore" && depth === 0) {
        // Skip dotfiles at root EXCEPT .gitignore; still walk .tpm via ignore set above if user wants it.
        // (Most dotfiles are config and not load-bearing for classification.)
        continue;
      }
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;

      const absEntry = path.join(absDir, entry.name);
      const relEntry = relDir ? path.join(relDir, entry.name) : entry.name;

      let stat: fs.Stats | null = null;
      try {
        stat = follow ? fs.statSync(absEntry) : fs.lstatSync(absEntry);
      } catch {
        continue;
      }

      if (entry.isDirectory() || (follow && stat.isDirectory())) {
        dirCount++;
        const item: SnapshotEntry = { path: relEntry, kind: "dir", depth };
        tree.push(item);
        if (depth === 0) topLevel.push(item);
        walk(absEntry, relEntry, depth + 1);
      } else if (entry.isFile() || (follow && stat.isFile())) {
        fileCount++;
        const item: SnapshotEntry = {
          path: relEntry,
          kind: "file",
          depth,
          size_bytes: stat.size,
        };
        tree.push(item);
        if (depth === 0) topLevel.push(item);
      }
    }
  }

  walk(projectRoot, "", 0);

  // Scan for manifests across the full tree we recorded.
  const treePathSet = new Set(tree.map((e) => e.path));
  const manifestPresence = WELL_KNOWN_MANIFESTS.filter((m) => {
    if (treePathSet.has(m)) return true;
    // Some manifests live one level down (e.g., src-tauri/Cargo.toml)
    // — match by basename in entries with depth <= 2.
    return tree.some((e) => e.depth <= 2 && e.kind === "file" && path.basename(e.path) === m);
  });

  return {
    root_path: projectRoot,
    top_level_entries: topLevel,
    shallow_tree: tree,
    manifest_presence: manifestPresence,
    total_file_count: fileCount,
    total_dir_count: dirCount,
    truncated,
  };
}
