import * as fs from "node:fs";
import * as path from "node:path";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import type { Delta } from "@tpm/shared/schemas/delta";
import type { Problems } from "@tpm/shared/schemas/problems";
import type { Solutions } from "@tpm/shared/schemas/solutions";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { ProductContext } from "../../core/project-config.js";
import { stageFContextPreamble } from "../../core/product-context.js";
import { runStage, textParse, type StageSpec } from "../_lib/stage-runner.js";
import { combine, hasRequiredSections, minLength } from "../_lib/validators.js";

export const STAGE_F_MODEL = "claude-sonnet-4-6";
const STAGE_F_MAX_TOKENS = 16_000;

// Compact "Slack thread" structure. A real user's review of the
// previous long-form spec.md called out two failures: the report
// read like a code review (too negative, graded a personal tool
// against distribution criteria) and was too long (nobody reads
// 4,000 words). The fix here is structural: lead with what works,
// keep the top of the doc Slack-message-short, put the full analysis
// behind a <details> fold for anyone who wants it.
//
// Tone expectation: a senior PM giving peer feedback, not a security
// auditor writing findings. Credit what works before naming friction.
const STAGE_F_SYSTEM = `You are TPM's writer. Produce a CONCISE spec.md that a senior PM would actually read.

A senior PM does three things this writing must also do:
  1. Credit what works before naming what doesn't. The first thing the reader sees is "you built something, here's what's strong about it." This isn't flattery — it's accurate observation of the parts of the audit data that show intent being delivered on.
  2. Use constructive framing. "The biggest leverage here is X" instead of "the product is structurally broken." "Worth investing in Y" instead of "critical defect." The audit found real things; how you name them shapes whether the reader acts on them or gets defensive.
  3. Keep it scannable. The top of the doc is readable in 30 seconds; the full thing in under 3 minutes. Anyone who wants more detail opens the <details> block. Do not repeat the same finding in multiple sections.

STRUCTURE — produce EXACTLY these sections in this order, using the ## heading syntax shown:

# TPM · <short project label>

## What works

Two to four short bullets. Each names one concrete strength observed in the code or the audit data — a file, a flow, an architectural choice. Be specific, not generic. Examples: "PIN setup (steps 1–5) is cleanly structured with an appropriately protective confirmation step"; "The SQLite-with-session-id schema makes audit state recoverable mid-run." Avoid empty praise like "well-organized code."

## Top move

One short paragraph (≤3 sentences) naming the single highest-leverage change. Phrase as an invitation, not a verdict. Name the specific file(s) or screen(s) affected. If there isn't a clear top move because the product is in good shape, say that instead.

## Other friction

Two to four short bullets. One sentence each: the issue + why it matters. No long explanations.

## Recommended moves

Numbered list of 3–5 short items. One line each: the change, plus an effort tag (S / M / L).

<details>
<summary>Full analysis</summary>

Longer-form content for anyone who wants the intent → reality delta, per-persona paths, pattern matches, and full leverage arguments. Same material that used to live in sections like "Intended Product", "Observed Reality", "The Delta" — but re-ordered and tightened. Put the verbose analysis here, not above.

Include:
- **Intent** — the reconstructed Lean Canvas in ≤6 lines (problem, segments if any, UVP, JTBD per persona).
- **Paths observed** — one line per persona: did they reach the value moment? If not, where did they stop.
- **Delta details** — ≤8 lines of the per-persona breakdown, only if it adds signal beyond "Other friction" above.
- **Problems ranked 1–N** — one line per problem: rank, title, one-sentence leverage argument.
- **Solutions** — one line per solution: ID, title, link to prototype HTML path.
- **Methodology note** — two sentences at most.

</details>

LENGTH BUDGET:
- Everything OUTSIDE the <details> block: target 250–400 words, hard max 600. If you're writing longer than that, you're padding.
- Inside the <details>: however long it needs to be, but trim obvious repetition.

TONE CHECK before returning:
- Did you name what works first, specifically?
- Did you frame the top move as invitation, not verdict?
- Did you avoid "structurally broken" / "configuration theater" / "this serves exactly one user" type language?
- Did you use product-context appropriate framing (a personal tool's "missing config UI" is not a defect; a WIP's unbuilt features are roadmap, not failures)?

Return only markdown. No code fences around the whole doc. No preamble.`;

const REQUIRED_SECTIONS = ["What works", "Top move", "Other friction", "Recommended moves"];

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
  productContext?: ProductContext;
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
  // Product-context preamble prepended to the user prompt; system
  // prompt stays audit-agnostic so cache hits still work across audits.
  const contextPreamble = stageFContextPreamble(deps.productContext);
  const userPrompt = `${contextPreamble}\n\n${buildUserPrompt(i)}`;

  const spec: StageSpec<string> = {
    name: "F",
    label: "Stage F · assembling spec.md",
    model: STAGE_F_MODEL,
    maxTokens: STAGE_F_MAX_TOKENS,
    temperature: 0.2,
    responseFormat: "text",
    systemPrompt: STAGE_F_SYSTEM,
    userPrompt,
    parse: (raw) => textParse(raw),
    validate: (parsed) => parsed as string,
    // Spec.md should be tight — the new prompt budgets 250-400 words
    // for the scannable top. Minimum drops from 1000 → 400 chars to
    // match. Required sections reflect the new structure.
    semanticCheck: (md) =>
      combine(hasRequiredSections(md, REQUIRED_SECTIONS), minLength(md, 400, "spec.md")),
    cacheSystem: true,
  };

  const result = await runStage<string>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  const markdown = result.output;

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const mdPath = path.join(deps.artifactsDir, "spec.md");
  fs.writeFileSync(mdPath, markdown);

  const htmlPath = path.join(deps.artifactsDir, "spec.html");
  fs.writeFileSync(htmlPath, renderMarkdownToHtml(markdown));

  return {
    markdownPath: mdPath,
    pdfPath: null,
    neurons: result.totalNeurons,
  };
}

// Minimal markdown→HTML for the PDF. Not a full MD renderer — handles
// the subset Stage F emits: #/##/### headings, **bold**, *italic*,
// inline `code`, paragraphs, bullet lists, `[text](url)` links, and
// GitHub-flavored <details>/<summary> fold blocks (so the "Full
// analysis" section collapses in the rendered HTML the same way it
// does on GitHub).
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
    details { margin: 1.5rem 0; border-top: 1px solid #ddd; padding-top: 1rem; }
    details summary { cursor: pointer; font-weight: 600; color: #4d4d4d; }
    details[open] summary { margin-bottom: 1rem; }
    .brand { color: #0654ba; font-weight: 600; letter-spacing: 0.03em; }
  `;
  const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Lines that pass through verbatim — HTML tags Stage F emits that
  // we don't want escaped. Pattern is "starts with an opening or
  // closing <details>/<summary> tag". Keeps the rest of the line
  // handling simple.
  const passthroughRe = /^<\/?(details|summary)\b[^>]*>\s*/i;
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
    if (passthroughRe.test(line)) {
      // <details>/</details>/<summary>...</summary> lines. If a
      // <summary> line has inner text after the opening tag, escape
      // just the inner portion; otherwise emit verbatim.
      if (inList) {
        body.push("</ul>");
        inList = false;
      }
      const summaryWithText = /^<summary\b[^>]*>(.+)<\/summary>\s*$/i.exec(line);
      if (summaryWithText) {
        body.push(`<summary>${inlineMd(escape(summaryWithText[1] ?? ""))}</summary>`);
      } else {
        body.push(line);
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
