import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { snapshotRepo } from "./snapshot.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-snapshot-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function touch(p: string, content = ""): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe("snapshotRepo", () => {
  it("captures top-level files + dirs deterministically", () => {
    touch(path.join(tmp, "package.json"), "{}");
    touch(path.join(tmp, "README.md"), "# test");
    fs.mkdirSync(path.join(tmp, "src"));
    touch(path.join(tmp, "src", "index.ts"), "export {};");
    const snap = snapshotRepo(tmp);
    expect(snap.top_level_entries.map((e) => e.path).sort()).toEqual([
      "README.md",
      "package.json",
      "src",
    ]);
    expect(snap.manifest_presence).toContain("package.json");
    expect(snap.total_file_count).toBe(3);
    expect(snap.total_dir_count).toBe(1);
  });

  it("ignores node_modules and .git", () => {
    touch(path.join(tmp, "package.json"));
    touch(path.join(tmp, "node_modules", "some-dep", "index.js"));
    touch(path.join(tmp, ".git", "config"));
    touch(path.join(tmp, "src", "app.ts"));
    const snap = snapshotRepo(tmp);
    const paths = snap.shallow_tree.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
    expect(paths.some((p) => p.startsWith("src"))).toBe(true);
  });

  it("detects Electron manifest presence without reading contents", () => {
    touch(path.join(tmp, "package.json"), '{"main":"./out/main/index.js"}');
    touch(path.join(tmp, "electron.vite.config.ts"), "// config");
    touch(path.join(tmp, "electron-builder.yml"), "# config");
    const snap = snapshotRepo(tmp);
    expect(snap.manifest_presence).toContain("package.json");
    expect(snap.manifest_presence).toContain("electron.vite.config.ts");
    expect(snap.manifest_presence).toContain("electron-builder.yml");
  });

  it("finds nested manifests one level down (e.g., src-tauri/Cargo.toml)", () => {
    touch(path.join(tmp, "package.json"));
    touch(path.join(tmp, "src-tauri", "Cargo.toml"), "[package]");
    touch(path.join(tmp, "src-tauri", "src", "main.rs"));
    const snap = snapshotRepo(tmp);
    expect(snap.manifest_presence).toContain("Cargo.toml");
    expect(snap.manifest_presence).toContain("package.json");
  });

  it("honors max_entries cap and flags truncated", () => {
    // Create more than 20 files then cap at 10.
    for (let i = 0; i < 30; i++) touch(path.join(tmp, `f${i}.ts`));
    const snap = snapshotRepo(tmp, { maxEntries: 10 });
    expect(snap.shallow_tree.length).toBeLessThanOrEqual(10);
    expect(snap.truncated).toBe(true);
  });

  it("respects max_depth", () => {
    touch(path.join(tmp, "a", "b", "c", "d", "deep.ts"));
    const snap = snapshotRepo(tmp, { maxDepth: 2 });
    const paths = snap.shallow_tree.map((e) => e.path);
    expect(paths.some((p) => p === path.join("a", "b", "c"))).toBe(true);
    expect(paths.some((p) => p.endsWith("deep.ts"))).toBe(false); // depth 4, past limit
  });

  it("sorts deterministically (dirs first, then alpha)", () => {
    touch(path.join(tmp, "zebra.ts"));
    touch(path.join(tmp, "alpha.ts"));
    fs.mkdirSync(path.join(tmp, "aardvark"));
    fs.mkdirSync(path.join(tmp, "zoo"));
    const snap = snapshotRepo(tmp);
    expect(snap.top_level_entries.map((e) => e.path)).toEqual([
      "aardvark",
      "zoo",
      "alpha.ts",
      "zebra.ts",
    ]);
  });
});
