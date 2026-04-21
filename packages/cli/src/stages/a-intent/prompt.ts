import type { Map as MapNs, Scraped as ScrapedNs } from "@tpm/shared";

export const STAGE_A_SYSTEM_PROMPT = `You are PM, a Technical Product Manager that reconstructs product intent.

Primary source of truth: the CODEBASE. User-facing copy in components, routes, forms, auth providers, tracking events, package.json metadata, README text — these are the definitive evidence of what the product is and does.

Auxiliary context (may or may not be provided): the product's public MARKETING SURFACES (landing page, pricing, features, docs). If present, these help you understand positioning and the marketing promise — but marketing copy often diverges from what the code actually delivers. When code and marketing conflict, the code wins (and you should record the divergence as a low-confidence marketing claim).

You do NOT run the product, walk it as a user, or sign up. Everything here is static inference.

From the evidence, fill in a Lean Canvas, then derive: Intended JTBD per segment, Intended Value Moment per persona, Intended Critical Path per persona.

Rules you MUST follow:
1. Every claim cites evidence. Evidence is a short string identifying the source. Use "codebase_static_map: …" for code-derived claims (preferred) and "marketing: …" for marketing-surface claims (auxiliary).
2. Every claim has a confidence score in [0,1]. Be calibrated — 0.9+ only when evidence is explicit and consistent, 0.5 when inferring, 0.2 when guessing.
3. Empty arrays are fine when evidence is absent. Do NOT invent.
4. Cost structure is NOT extractable — return {"extractable": false}.
5. Unfair advantage often reads aspirational; only include items with clear evidence and mark low confidence when substantive.
6. For each customer segment, derive exactly one intended JTBD, one intended value moment, and one intended critical path, using the same segment_id string across the three.
7. Intended critical paths should reflect the PRODUCT BUILDER'S implicit intent — what the hero copy promises + what onboarding routes + navigation structure suggest. Not what a user actually experiences.
8. Respond with a single JSON object that matches the provided schema. No prose, no code fences. The pipeline parses the output mechanically.`;

export interface StageAInput {
  map: MapNs.Map;
  scraped?: ScrapedNs.ScrapedSurfaces | undefined;
}

function compactMap(map: MapNs.Map): unknown {
  const byCtx: Record<string, string[]> = {};
  for (const s of map.visible_strings) {
    byCtx[s.context] = byCtx[s.context] ?? [];
    if ((byCtx[s.context] as string[]).length < 30) (byCtx[s.context] as string[]).push(s.text);
  }
  return {
    framework: map.framework,
    package: map.package,
    routes: map.routes.slice(0, 100),
    components_count: map.components.length,
    components_top: map.components.slice(0, 40).map((c) => c.name),
    forms: map.forms,
    visible_strings_by_context: byCtx,
    nav: map.navigation.slice(0, 40).map((n) => {
      const item: { label: string; href?: string } = { label: n.label };
      if (n.href !== undefined) item.href = n.href;
      return item;
    }),
    tracking_events: map.tracking_events.slice(0, 80),
    auth_providers: map.auth_providers,
  };
}

function compactSurfaces(scraped: ScrapedNs.ScrapedSurfaces): unknown[] {
  return scraped.surfaces.map((s) => ({
    url: s.url,
    kind: s.kind,
    meta_title: s.meta.title,
    meta_description: s.meta.description ?? s.meta.og_description,
    h1: s.h1,
    h2: s.h2.slice(0, 15),
    hero_copy: s.hero_copy,
    subhero_copy: s.subhero_copy,
    ctas: s.ctas.slice(0, 10),
    pricing_tiers: s.pricing_tiers,
    nav_labels: s.nav_links.map((l) => l.label).slice(0, 20),
    testimonials: s.testimonials.slice(0, 5),
    text_excerpt: s.text_excerpt.slice(0, 2000),
  }));
}

export function buildStageAUserPrompt(input: StageAInput): string {
  const lines: string[] = [
    "=== PRIMARY: STATIC CODE MAP ===",
    JSON.stringify(compactMap(input.map), null, 2),
    "",
  ];
  if (input.scraped && input.scraped.surfaces.length > 0) {
    lines.push(
      "=== AUXILIARY: SCRAPED MARKETING SURFACES ===",
      "(Use to understand positioning. Code wins when it conflicts.)",
      JSON.stringify(compactSurfaces(input.scraped), null, 2),
      "",
    );
  } else {
    lines.push(
      "=== AUXILIARY: SCRAPED MARKETING SURFACES ===",
      "(none provided — run audit with a marketing URL to add this context)",
      "",
    );
  }
  lines.push(
    "=== TASK ===",
    "Produce ONE JSON object matching this TypeScript shape:",
    "",
    "type Output = {",
    "  schema_version: 1,",
    "  extracted_at: string, // ISO 8601",
    "  model: string,",
    "  sources: Array<{ type: 'codebase_static_map'|'landing_page'|'pricing_page'|'features_page'|'docs'|'other', url?: string, hash?: string, scraped_at?: string }>,",
    "  lean_canvas: {",
    "    problem: { items: Array<{ statement: string, evidence: string[], confidence: number }> },",
    "    customer_segments: { items: Array<{ segment: string, evidence: string[], confidence: number }> },",
    "    unique_value_proposition: { statement: string, evidence: string[], confidence: number },",
    "    solution: { items: Array<{ feature: string, evidence: string[] }> },",
    "    channels: { items: Array<{ channel: string, evidence: string[], confidence: number }> },",
    "    revenue_streams: { items: Array<{ stream: string, evidence: string[], confidence: number }> },",
    "    cost_structure: { extractable: false, note?: string },",
    "    key_metrics: { items: Array<{ metric: string, evidence: string[] }> },",
    "    unfair_advantage: { items: Array<{ claim: string, evidence: string[], confidence: number }> }",
    "  },",
    "  intended_jtbd_per_segment: Array<{ segment_id: string, job: string, actor: string, trigger: string, success_criterion: string, confidence: number }>,",
    "  intended_value_moments: Array<{ segment_id: string, value_moment: string, rationale: string, confidence: number }>,",
    "  intended_critical_paths: Array<{ segment_id: string, ideal_steps: string[], estimated_step_count: number, source: string, confidence: number }>",
    "}",
    "",
    "Return only the JSON object.",
  );
  return lines.join("\n");
}
