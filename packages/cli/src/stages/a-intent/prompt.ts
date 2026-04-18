import type { Map as MapNs, Scraped as ScrapedNs } from "@tpm/shared";

export const STAGE_A_SYSTEM_PROMPT = `You are TPM, a Technical Product Manager that reconstructs product intent from a codebase and its deployed marketing site.

Your job in Stage A is to fill in a Lean Canvas from evidence the pipeline has gathered, then derive three downstream artifacts: Intended JTBD per segment, Intended Value Moment per persona, and Intended Critical Path per persona.

Rules you MUST follow:
1. Every claim must cite evidence. Evidence is a short string describing the source: "landing_page: hero tagline", "codebase_static_map: package.json description", "pricing_page: tier name 'Enterprise'", etc.
2. Every claim has a confidence score in [0,1]. Be calibrated — use 0.9+ only when evidence is explicit and consistent, 0.5 when inferring, 0.2 when guessing.
3. When the evidence is weak or absent, say so by returning fewer items (empty arrays are fine). Do NOT invent.
4. Cost structure is NOT extractable from code or marketing — return {"extractable": false}.
5. Unfair advantage often reads aspirational; only include items with clear evidence and mark low confidence when substantive.
6. For each customer segment, derive exactly one intended JTBD, one intended value moment, and one intended critical path, using the same segment_id string across the three.
7. Intended critical paths should reflect the PRODUCT BUILDER'S implicit intent — what the marketing promises + what the onboarding wizard + navigation structure suggests. Not what actually happens; that's Stage B's job.
8. Respond with a single JSON object that matches the provided schema. No prose, no code fences, no commentary. The pipeline parses the output mechanically.`;

export interface StageAInput {
  map: MapNs.Map;
  scraped: ScrapedNs.ScrapedSurfaces;
}

interface TruncatedMap {
  framework: string;
  package: MapNs.Map["package"];
  routes: MapNs.RouteInfo[];
  components_count: number;
  components_top: string[];
  forms: MapNs.FormInfo[];
  visible_strings_by_context: Record<string, string[]>;
  nav: Array<{ label: string; href?: string }>;
  tracking_events: MapNs.TrackingEvent[];
  auth_providers: MapNs.Map["auth_providers"];
}

function compactMap(map: MapNs.Map): TruncatedMap {
  const byCtx: Record<string, string[]> = {};
  for (const s of map.visible_strings) {
    byCtx[s.context] = byCtx[s.context] ?? [];
    if ((byCtx[s.context] as string[]).length < 30) (byCtx[s.context] as string[]).push(s.text);
  }
  return {
    framework: map.framework,
    package: map.package,
    routes: map.routes.slice(0, 80),
    components_count: map.components.length,
    components_top: map.components.slice(0, 30).map((c) => c.name),
    forms: map.forms,
    visible_strings_by_context: byCtx,
    nav: map.navigation.slice(0, 20).map((n) => {
      const item: { label: string; href?: string } = { label: n.label };
      if (n.href !== undefined) item.href = n.href;
      return item;
    }),
    tracking_events: map.tracking_events.slice(0, 50),
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
  const compact = {
    static_map: compactMap(input.map),
    scraped_surfaces: compactSurfaces(input.scraped),
  };
  return [
    "Here is the structured evidence for this product.",
    "",
    "=== STATIC MAP (codebase) ===",
    JSON.stringify(compact.static_map, null, 2),
    "",
    "=== MARKETING SURFACES (scraped) ===",
    JSON.stringify(compact.scraped_surfaces, null, 2),
    "",
    "=== TASK ===",
    "Produce ONE JSON object matching this TypeScript shape:",
    "",
    "type Output = {",
    "  schema_version: 1,",
    "  extracted_at: string, // ISO 8601",
    "  model: string,",
    "  sources: Array<{ type: 'landing_page'|'pricing_page'|'features_page'|'docs'|'codebase_static_map'|'other', url?: string, hash?: string, scraped_at?: string }>,",
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
  ].join("\n");
}
