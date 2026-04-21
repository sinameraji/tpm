// Maps the user's product-context choice to prompt preambles that
// Stage A (intent extraction) and Stage F (report writing) inject
// into their system/user messages.
//
// Motivation — from a real user review of an early 1.2.0 audit:
//   "The TPM assumed Daily Ledger is a distributable product for a
//    target persona and then graded it against that imagined spec.
//    It isn't. It's a personal tool, and the entire report is built
//    on a misread of the product's purpose."
//
// Without explicit context, PM's Stage A used to invent target
// personas from static strings in the codebase (hero copy in a
// landing page, README phrasing). For a personal tool that has none
// of that, PM fell back on generic "knowledge worker" patterns and
// then critiqued missing distribution-readiness as critical defects.
//
// The fix is grounding, not a tone patch. When the user tells us
// "this is personal" or "this is WIP", the whole grading lens changes:
//   - personal  → polish + utility for the developer, not onboarding
//   - internal  → handoff + shared workflow, not marketing-readiness
//   - distributable → the current full distribution-focused lens
//   - wip       → shape + direction; unimplemented features are
//                 roadmap, not defects
//   - other     → trust the user's free-form description

import type { ProductContext } from "./project-config.js";

export function stageAContextPreamble(ctx: ProductContext | undefined): string {
  if (!ctx) {
    // No context provided — grade neutrally, don't assume distribution.
    return `PRODUCT CONTEXT: not specified.
Ground your Lean Canvas in concrete evidence from the codebase only. Do NOT invent target personas from generic marketing language unless the repo has an explicit landing page or README naming them. If the codebase looks single-user (hard-coded values, no onboarding path, no auth for other accounts), prefer a Lean Canvas that reflects that reality — a tool built for one user is a valid shape, not a defect.`;
  }
  switch (ctx.kind) {
    case "personal":
      return `PRODUCT CONTEXT: personal tool. The developer IS the user. Single-person scope is a design choice, not a defect.
Ground the Lean Canvas on the developer as the sole persona. Do NOT invent "target segments" beyond this one person. Hard-coded configuration for the developer's own data is correct, not a bug. Missing onboarding, marketing copy, distribution flow, first-run wizard for hypothetical other users — none of these are problems for this product.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "internal":
      return `PRODUCT CONTEXT: internal team tool. Users are known colleagues who can be onboarded in person.
Treat the team as the target persona (a single persona, plural users). Do NOT grade on public-marketing polish, external onboarding, or distribution mechanics. DO grade on shared workflow quality, handoff points between team members, and whether the tool's intent is clear to someone who joins mid-project.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "distributable":
      return `PRODUCT CONTEXT: distributable product aimed at external users.
Use the full distribution-readiness grading lens: derive target personas from the product's public-facing positioning (landing page hero copy, README, naming), and grade against whether those personas can reach the stated value moment from a clean install.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "wip":
      return `PRODUCT CONTEXT: work in progress. The product is partially implemented; features mentioned in the code/roadmap but not yet built are EXPECTED, not defects.
Extract intent from what's been built, not from the aspirational surface. Note unimplemented features as known_unknowns / roadmap items rather than failures of promise. The grading lens is "shape + direction are the build going well?" — not "does the current checkpoint fully deliver the final product."
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "other":
      return `PRODUCT CONTEXT (user-described): ${ctx.note ?? "unspecified"}.
Use this description to ground the Lean Canvas. Do NOT contradict it with inferences from generic code patterns.`;
  }
}

export function stageFContextPreamble(ctx: ProductContext | undefined): string {
  if (!ctx) {
    return `PRODUCT CONTEXT: not specified.
Frame findings as opportunities for code-level polish and flow quality. Do NOT assume the product is meant for external distribution unless the evidence clearly supports it.`;
  }
  switch (ctx.kind) {
    case "personal":
      return `PRODUCT CONTEXT: personal tool. Developer = user.
Tone: collegial and collaborative. Think "a friend showing you their weekend project." What Works should be specific and generous about the choices that work well for single-person use. Top Move should be framed as "the biggest polish" or "the next thing to sharpen," never as a distribution critique. Do NOT flag missing onboarding / missing config UI / single-user scope as problems; those are design choices for this kind of product.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "internal":
      return `PRODUCT CONTEXT: internal team tool.
Tone: peer-review. What Works calls out the parts that make the team's workflow smoother. Top Move is framed around handoff quality, shared understanding, or team-onboarding friction. Do NOT grade on external-facing polish.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "distributable":
      return `PRODUCT CONTEXT: product aimed at external users.
Tone: PM-to-PM. Honest, constructive, concrete. What Works credits the strong parts of the distribution story (onboarding, clarity of value, first-run experience). Top Move is whatever unblocks the most users' value moment.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "wip":
      return `PRODUCT CONTEXT: work in progress.
Tone: builder-to-builder, looking at shape in flight. What Works credits the direction and the architectural bets made early. Top Move is framed as "the next milestone that will unlock the most" — an invitation, not a verdict. Do NOT flag unbuilt features as critical; name them as roadmap and focus on shape.
${ctx.note ? `User note: ${ctx.note}` : ""}`;
    case "other":
      return `PRODUCT CONTEXT (user-described): ${ctx.note ?? "unspecified"}.
Frame the report to match this context. Do NOT override the user's framing with your own assumptions about distribution or target users.`;
  }
}
