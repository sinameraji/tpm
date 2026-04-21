#!/usr/bin/env node
// Bundles the CLI entry point with @pm/shared inlined, while keeping
// real npm deps external. Produces a single dist/bin/pm.js suitable
// for `npm publish`.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..");

// Read package.json to pin external deps exactly.
const pkg = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (d) => d !== "@pm/shared", // inline shared; everything else stays external
);

await build({
  entryPoints: [path.join(cliRoot, "bin/pm.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(cliRoot, "dist/bin/pm.js"),
  external,
  sourcemap: true,
  loader: { ".yaml": "text" },
  logLevel: "info",
});

// esbuild preserves the source-level shebang; just mark the bundled
// output executable so `npm install -g` links it correctly.
const outfile = path.join(cliRoot, "dist/bin/pm.js");
fs.chmodSync(outfile, 0o755);
console.log("✓ bundled dist/bin/pm.js");
