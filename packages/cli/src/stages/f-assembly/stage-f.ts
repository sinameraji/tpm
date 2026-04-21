import * as fs from "node:fs";
import * as path from "node:path";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import type { Delta } from "@tpm/shared/schemas/delta";
import type { Problems } from "@tpm/shared/schemas/problems";
import type { Solution, Solutions } from "@tpm/shared/schemas/solutions";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { ProductContext } from "../../core/project-config.js";
import { stageFContextPreamble } from "../../core/product-context.js";
import { runStage, textParse, type StageSpec } from "../_lib/stage-runner.js";
import { combine, hasRequiredSections, minLength } from "../_lib/validators.js";

export const STAGE_F_MODEL = "claude-sonnet-4-6";
const STAGE_F_MAX_TOKENS = 16_000;

// spec.md is now an ultra-short narrative — one founder-voice essay
// explaining what PM saw. The detailed per-solution specs live as
// separate files (solutions/S001-*.md) that PM writes
// deterministically from solutions.yaml after Stage F finishes.
// spec.md links to those + the prototypes prominently; it does not
// repeat their content.
//
// A real user's feedback on beta.13's spec.md was "still too much
// text. I prefer specs separate from explanation, like an Intercom
// Intermission-style article that links to detailed specs." Also
// "as a founder I want strategic/tactical advice, not class names."
// That's what this prompt aims for.
const STAGE_F_SYSTEM = `You are writing a short narrative spec.md for a product audit. Think Intercom-style editorial post: an essay explaining what you saw, linking to the detailed specs as separate files.

VOICE: a founder-to-founder peer talking over coffee. Strategic and tactical. NOT a code reviewer.

HARD RULES on content:
- NO file names, class names, function names, component names. Say "the dashboard" not "DashboardView.tsx". Say "the sign-in flow" not "AuthContext.tsx".
- NO code snippets, TypeScript types, or implementation language.
- NO "edit this line to do that" instructions. Detailed implementation lives in the solutions/*.md files (written separately).
- The narrative is product-level observation. The specs are technical. Keep them in their own lanes.

STRUCTURE — produce EXACTLY these sections in this order:

# <Product name>

One paragraph (2–4 sentences) naming what this product is, what it's clearly doing well, and the single biggest thing worth polishing. Written as observation, not verdict. No bullet points in this opener.

## Do these next

Numbered list, ≤3 items. Each item is TWO LINES:
- Line 1: **<one-line title of the move>** — effort: S / M / L
- Line 2: One sentence explaining why it matters NOW (the strategic rationale — what does it unlock, what pain does it remove). Then: "→ [spec](./solutions/<id>.md) · [prototype](./prototypes/<filename>.html)"

Solution IDs and prototype filenames will be provided in the input under "solutions_index" — use those exact paths for the links. Do not invent them.

## What to notice

Optional section, only include if there's a product-level observation worth naming that isn't implicit in "Do these next." Two to four short bullets. Product-level, not code-level. Examples: "The auth flow is load-bearing for the whole experience, not just a gate"; "Your metrics answer the exact question the app exists for — nothing is noise." Do NOT repeat anything from "Do these next."

TOTAL LENGTH: target 180–280 words for the whole doc. Hard max 350. If you're writing longer, you're padding.

TONE CHECK:
- No "structurally broken" / "critical defect" / "does not serve" language.
- No inventing personas or scope not in the audit data or product context.
- Do NOT list every problem PM found. Pick the moves that matter and link to the detailed specs for the rest.

Return only markdown. No code fences around the doc. No preamble.`;

// Narrative-style structure; the required-sections check now just
// validates the two top-level sections that every spec.md must have.
const REQUIRED_SECTIONS = ["Do these next"];

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

function slugifyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// Exact filenames for the per-solution spec markdown files. Stage F
// uses these both for writing the files AND for giving Claude the
// links to put in spec.md so they line up on disk.
export function solutionSpecFilename(id: string, title: string): string {
  const slug = slugifyTitle(title);
  return slug ? `${id}-${slug}.md` : `${id}.md`;
}

function buildUserPrompt(i: StageFInputs): string {
  // solutions_index is the exact link manifest Stage F must use when
  // writing "Do these next". Giving Claude the pre-computed filenames
  // prevents it from inventing paths that don't match what we write
  // to disk below.
  const solutionsIndex = i.solutions.solutions.map((s) => ({
    id: s.id,
    title: s.title,
    effort: s.effort_estimate.size,
    rationale: s.why_right_fix,
    spec_path: `./solutions/${solutionSpecFilename(s.id, s.title)}`,
    prototype_path: s.prototype?.path ? `./${s.prototype.path}` : null,
  }));

  // Audit context Claude needs to write the narrative — product-level
  // facts, not implementation details. We deliberately DON'T pass the
  // full solutions objects (implementation_outline, scope, risks) —
  // those belong in solutions/*.md, not spec.md. Giving Claude that
  // data tempts it to mention file names.
  const narrativeInput = {
    lean_canvas_summary: {
      problem: i.leanCanvas.lean_canvas.problem.items.map((p) => p.statement),
      uvp: i.leanCanvas.lean_canvas.unique_value_proposition.statement,
      segments: i.leanCanvas.lean_canvas.customer_segments.items.map((s) => s.segment),
    },
    paths_outcomes: i.paths.paths.map((p) => ({
      persona: p.persona,
      value_moment_reached: p.outcome.value_moment_reached,
      steps_taken: p.steps_taken,
      stuck_reason: p.outcome.stuck_reason,
    })),
    overall_health: i.delta.overall_health,
    top_problems: i.problems.problems.slice(0, 5).map((p) => ({
      id: p.id,
      rank: p.rank,
      title: p.title,
      leverage_argument: p.leverage_argument,
    })),
    solutions_index: solutionsIndex,
  };

  return [
    "=== PRODUCT-LEVEL AUDIT CONTEXT ===",
    JSON.stringify(narrativeInput, null, 2),
    "",
    "Write spec.md now. Use the `solutions_index.spec_path` and `solutions_index.prototype_path` values EXACTLY as the links in the 'Do these next' section — don't invent filenames. Product-level narrative only; no class/file/function names.",
  ].join("\n");
}

// ---- Per-solution markdown spec emitter --------------------------------
//
// Solutions/*.md are written deterministically from solutions.yaml — no
// LLM call needed. spec.md (the narrative) links to each of these.
// Splits the detailed implementation content out of spec.md so the
// narrative stays short and the technical detail stays accessible to
// whoever's going to implement.
function emitSolutionMarkdown(s: Solution): string {
  const lines: string[] = [];
  lines.push(`# ${s.id} — ${s.title}`);
  lines.push("");
  lines.push(`**Problem:** ${s.problem_ref}`);
  lines.push(
    `**Effort:** ${s.effort_estimate.size}${s.effort_estimate.weeks_estimate ? ` (~${s.effort_estimate.weeks_estimate})` : ""}`,
  );
  lines.push("");
  lines.push("## What changes");
  lines.push("");
  lines.push(s.change.what);
  if (s.change.scope && s.change.scope.length > 0) {
    lines.push("");
    lines.push("**Scope:**");
    for (const item of s.change.scope) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Why this is the right fix");
  lines.push("");
  lines.push(s.why_right_fix);
  if (s.unblocks && s.unblocks.length > 0) {
    lines.push("");
    lines.push("**Unblocks:**");
    for (const u of s.unblocks) {
      lines.push(`- **${u.problem_id}** — ${u.rationale}`);
    }
  }
  if (s.implementation_outline && s.implementation_outline.length > 0) {
    lines.push("");
    lines.push("## Implementation outline");
    lines.push("");
    for (const step of s.implementation_outline) {
      lines.push(`- ${step}`);
    }
  }
  if (s.effort_estimate.rationale) {
    lines.push("");
    lines.push("## Effort rationale");
    lines.push("");
    lines.push(s.effort_estimate.rationale);
  }
  if (s.risks_and_tradeoffs && s.risks_and_tradeoffs.length > 0) {
    lines.push("");
    lines.push("## Risks and tradeoffs");
    lines.push("");
    for (const r of s.risks_and_tradeoffs) {
      lines.push(`- **${r.risk}** — ${r.mitigation}`);
    }
  }
  lines.push("");
  lines.push("## Success metric");
  lines.push("");
  lines.push(`**Primary:** ${s.success_metric.primary}`);
  lines.push(`**Target:** ${s.success_metric.target}`);
  lines.push(`**Measurement window:** ${s.success_metric.measurement_window}`);
  if (s.success_metric.secondary && s.success_metric.secondary.length > 0) {
    lines.push("");
    lines.push("**Secondary:**");
    for (const m of s.success_metric.secondary) {
      lines.push(`- ${m}`);
    }
  }
  if (s.prototype?.path) {
    lines.push("");
    lines.push("## Prototype");
    lines.push("");
    lines.push(`[→ ${s.prototype.path}](../${s.prototype.path})`);
  }
  lines.push("");
  return lines.join("\n");
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

  // Write one markdown file per solution under ./solutions/. Stage F's
  // narrative spec.md links to these; they carry the technical detail
  // (scope, implementation outline, risks, success metric) so spec.md
  // can stay product-level. Purely formatting over solutions.yaml
  // data — no LLM call.
  const solutionsDir = path.join(deps.artifactsDir, "solutions");
  fs.mkdirSync(solutionsDir, { recursive: true });
  for (const solution of i.solutions.solutions) {
    const filename = solutionSpecFilename(solution.id, solution.title);
    const solutionMd = emitSolutionMarkdown(solution);
    fs.writeFileSync(path.join(solutionsDir, filename), solutionMd);
  }

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
    '<div class="brand">PM · Product Manager</div>',
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
