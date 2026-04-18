import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { PatternsSchema, type Pattern, type Patterns } from "@tpm/shared/schemas/patterns";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function builtInYamlPath(): string {
  const candidates = [
    path.resolve(HERE, "./built-in.yaml"),
    path.resolve(HERE, "../patterns/built-in.yaml"),
    path.resolve(HERE, "../../src/patterns/built-in.yaml"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`built-in.yaml not found near ${HERE}`);
}

export function loadBuiltInPatterns(): Patterns {
  const yamlPath = builtInYamlPath();
  const raw = fs.readFileSync(yamlPath, "utf8");
  const parsed = yaml.load(raw) as { schema_version: 1; patterns: Pattern[] };
  const libraryHash = crypto.createHash("sha256").update(raw).digest("hex");
  return PatternsSchema.parse({
    schema_version: 1,
    library_hash: libraryHash,
    patterns: parsed.patterns,
  });
}

// Compact summary used in Stage C prompt.
export function summarizePatternLibrary(patterns: Patterns): string {
  return patterns.patterns
    .map((p) => {
      const signals = p.body.detection_signals.map((s) => `  • ${s}`).join("\n");
      return [
        `- id: ${p.id}`,
        `  title: ${p.title}`,
        `  category: ${p.category}`,
        `  summary: ${p.body.summary}`,
        `  detection_signals:`,
        signals,
      ].join("\n");
    })
    .join("\n");
}
