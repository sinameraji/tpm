import * as fs from "node:fs";
import * as path from "node:path";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import type { Delta } from "@tpm/shared/schemas/delta";
import type { Problems } from "@tpm/shared/schemas/problems";
import type { Solutions } from "@tpm/shared/schemas/solutions";
import type { ModelGateway } from "../../gateway/index.js";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { Logger } from "../../core/logger.js";

export const STAGE_F_MODEL = "@cf/openai/gpt-oss-120b";

const STAGE_F_SYSTEM = `You are TPM's writer. Produce a spec.md document for a product audit.

Structure EXACTLY:
1. "# Executive Summary" — 3-5 sentences. Headline findings.
2. "## Intended Product" — Lean Canvas prose: the problem the builder is naming, who they're targeting, the UVP, the derived JTBD and value moments per persona.
3. "## Observed Reality" — per-persona journey summaries with key friction points.
4. "## The Delta" — intent vs reality. Key mismatches. Overall health. The implicit-vs-stated job analysis.
5. "## Top Problems" — ranked with the leverage argument for each.
6. "## Recommended Actions" — one subsection per top solution with what changes, why it's the right fix, effort, success metric. Link to the prototype HTML file.
7. "## Appendix — Methodology" — brief, one paragraph.

Markdown formatting. No HTML. Concise, PM-readable, professional. Don't pad.

Return only markdown.`;

export interface StageFInputs {
  leanCanvas: LeanCanvas;
  paths: Paths;
  delta: Delta;
  problems: Problems;
  solutions: Solutions;
}

export interface StageFDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  renderPdf?: boolean;
}

export interface StageFResult {
  markdownPath: string;
  pdfPath: string | null;
  neurons: number;
}

function buildUserPrompt(i: StageFInputs): string {
  const compact = {
    lean_canvas: i.leanCanvas.lean_canvas,
    intended_jtbd: i.leanCanvas.intended_jtbd_per_segment,
    intended_value_moments: i.leanCanvas.intended_value_moments,
    intended_critical_paths: i.leanCanvas.intended_critical_paths,
    paths_outcomes: i.paths.paths.map((p) => ({
      persona: p.persona,
      outcome: p.outcome,
      steps_taken: p.steps_taken,
    })),
    delta: i.delta,
    problems: i.problems.problems,
    solutions: i.solutions.solutions.map((s) => ({
      id: s.id,
      problem_ref: s.problem_ref,
      title: s.title,
      change: s.change,
      why_right_fix: s.why_right_fix,
      effort_estimate: s.effort_estimate,
      success_metric: s.success_metric,
      prototype_path: s.prototype?.path,
    })),
  };
  return [
    "=== FULL AUDIT DATA (JSON) ===",
    JSON.stringify(compact, null, 2),
    "",
    "Write the spec.md now, following the structure in your system prompt exactly.",
  ].join("\n");
}

export async function runStageF(i: StageFInputs, deps: StageFDeps): Promise<StageFResult> {
  deps.logger.info({ stage: "F", audit_id: deps.auditId }, "stage F started");
  const opts: CompleteOptionsExt = {
    temperature: 0.2,
    responseFormat: "text",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "F",
    maxTokens: 32_000, // reasoning model headroom
  };
  let completion = await deps.gateway.complete(
    STAGE_F_MODEL,
    [
      { role: "system", content: STAGE_F_SYSTEM },
      { role: "user", content: buildUserPrompt(i) },
    ],
    opts,
  );
  if (!completion.text.trim()) {
    deps.logger.warn(
      { usage: completion.usage },
      "stage F returned empty; retrying with larger budget",
    );
    completion = await deps.gateway.complete(
      STAGE_F_MODEL,
      [
        { role: "system", content: STAGE_F_SYSTEM },
        { role: "user", content: buildUserPrompt(i) },
      ],
      { ...opts, maxTokens: 64_000 },
    );
    if (!completion.text.trim())
      throw new Error("Stage F returned empty output even at 64K tokens.");
  }

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const mdPath = path.join(deps.artifactsDir, "spec.md");
  fs.writeFileSync(mdPath, completion.text);

  // HTML render alongside — easy to convert to PDF with any tool if desired.
  const htmlPath = path.join(deps.artifactsDir, "spec.html");
  fs.writeFileSync(htmlPath, renderMarkdownToHtml(completion.text));

  deps.logger.info({ stage: "F", md: mdPath, html: htmlPath }, "stage F complete");
  return {
    markdownPath: mdPath,
    pdfPath: null,
    neurons: completion.usage.neurons ?? 0,
  };
}

// Minimal markdown→HTML for the PDF. Not a full MD renderer — handles
// the subset Stage F emits: #/##/### headings, **bold**, *italic*,
// inline `code`, paragraphs, bullet lists, and `[text](url)` links.
// Pretty enough for a PM spec; not a general-purpose library.
export function renderMarkdownToHtml(md: string): string {
  const css = `
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5;
           max-width: 48rem; margin: 2rem auto; color: #1a1a1a; padding: 0 1rem; }
    h1 { font-size: 1.8rem; margin-top: 0; border-bottom: 2px solid #ddd; padding-bottom: 0.3rem; }
    h2 { font-size: 1.3rem; margin-top: 2rem; }
    h3 { font-size: 1.1rem; margin-top: 1.5rem; }
    p  { margin: 0.8rem 0; }
    code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    ul { padding-left: 1.2rem; }
    a { color: #0654ba; }
    .brand { color: #0654ba; font-weight: 600; letter-spacing: 0.03em; }
  `;
  const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body: string[] = [];
  const lines = md.split(/\r?\n/);
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.length) {
      if (inList) {
        body.push("</ul>");
        inList = false;
      }
      continue;
    }
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    const li = /^[-*]\s+(.*)/.exec(line);
    let out: string;
    if (h3) out = `<h3>${escape(h3[1] ?? "")}</h3>`;
    else if (h2) out = `<h2>${escape(h2[1] ?? "")}</h2>`;
    else if (h1) out = `<h1>${escape(h1[1] ?? "")}</h1>`;
    else if (li) {
      if (!inList) {
        body.push("<ul>");
        inList = true;
      }
      out = `<li>${inlineMd(escape(li[1] ?? ""))}</li>`;
    } else {
      if (inList) {
        body.push("</ul>");
        inList = false;
      }
      out = `<p>${inlineMd(escape(line))}</p>`;
    }
    body.push(out);
  }
  if (inList) body.push("</ul>");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><style>',
    css,
    "</style></head><body>",
    '<div class="brand">TPM · Technical Product Manager</div>',
    body.join("\n"),
    "</body></html>",
  ].join("\n");
}

function inlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
