import * as cheerio from "cheerio";
import type {
  CTA,
  MetaTags,
  PricingTier,
  SchemaOrgEntity,
  ScrapedSurfaces,
  SurfaceDocument,
  SurfaceKind,
} from "@tpm/shared/schemas/scraped";
import { ScrapedSurfacesSchema } from "@tpm/shared/schemas/scraped";

const USER_AGENT = "PM-Auditor/1.0 (+https://pm-init.pages.dev)";

const CANDIDATE_PATHS: Array<{ path: string; kind: SurfaceKind }> = [
  { path: "/pricing", kind: "pricing" },
  { path: "/price", kind: "pricing" },
  { path: "/plans", kind: "pricing" },
  { path: "/features", kind: "features" },
  { path: "/product", kind: "features" },
  { path: "/docs", kind: "docs" },
  { path: "/documentation", kind: "docs" },
  { path: "/about", kind: "about" },
  { path: "/faq", kind: "faq" },
  { path: "/blog", kind: "blog" },
];

export interface ScrapeOptions {
  maxPages?: number;
  perRequestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  respectRobots?: boolean;
}

function classifySurface(url: string, h1s: string[]): SurfaceKind {
  const u = url.toLowerCase();
  if (/\/pricing|\/plans|\/price(?:$|\/)/.test(u)) return "pricing";
  if (/\/features|\/product(?:$|\/)/.test(u)) return "features";
  if (/\/docs|\/documentation/.test(u)) return "docs";
  if (/\/about/.test(u)) return "about";
  if (/\/faq/.test(u)) return "faq";
  if (/\/blog/.test(u)) return "blog";
  const asPath = new URL(u).pathname.replace(/\/$/, "");
  if (asPath === "" || asPath === "/") return "landing";
  const h = h1s.map((s) => s.toLowerCase()).join(" ");
  if (/pricing|plans/.test(h)) return "pricing";
  if (/features/.test(h)) return "features";
  return "other";
}

function parseMeta($: cheerio.CheerioAPI): MetaTags {
  const meta: MetaTags = {};
  const title = $("title").first().text().trim();
  if (title) meta.title = title;
  const set = (
    key: keyof MetaTags,
    selector: string,
    attr: "content" | "href" = "content",
  ): void => {
    const val = $(selector).first().attr(attr);
    if (val) meta[key] = val.trim();
  };
  set("description", 'meta[name="description"]');
  set("og_title", 'meta[property="og:title"]');
  set("og_description", 'meta[property="og:description"]');
  set("og_type", 'meta[property="og:type"]');
  set("twitter_card", 'meta[name="twitter:card"]');
  set("canonical", 'link[rel="canonical"]', "href");
  set("robots", 'meta[name="robots"]');
  return meta;
}

function parseCTAs($: cheerio.CheerioAPI, baseUrl: string): CTA[] {
  const out: CTA[] = [];
  const seen = new Set<string>();
  $("a, button").each((_i, el) => {
    const $el = $(el);
    const raw = $el.text().replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 48) return;
    if (
      !/^(start|try|get|book|sign\s?up|sign\s?in|log\s?in|buy|upgrade|request|contact|free|demo|download|launch|create|build|see|watch|explore)/i.test(
        raw,
      )
    )
      return;
    const href = $el.attr("href");
    const resolved = href ? new URL(href, baseUrl).toString() : undefined;
    const key = `${raw.toLowerCase()}|${resolved ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const parentTag = ($el.parent()[0] as { name?: string })?.name ?? "";
    const isHero =
      $el.parents("header, section").slice(0, 2).length > 0 &&
      /hero|header|^section/.test(parentTag);
    const item: CTA = {
      label: raw,
      prominence: isHero ? "primary" : out.length < 2 ? "secondary" : "tertiary",
    };
    if (resolved !== undefined) item.href = resolved;
    out.push(item);
  });
  return out.slice(0, 20);
}

function parseSchemaOrg($: cheerio.CheerioAPI): SchemaOrgEntity[] {
  const out: SchemaOrgEntity[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).contents().text();
    if (!text) return;
    try {
      const json = JSON.parse(text) as unknown;
      const items = Array.isArray(json) ? json : [json];
      for (const it of items) {
        if (typeof it !== "object" || it === null) continue;
        const typed = it as { "@type"?: string; name?: string; description?: string };
        const entity: SchemaOrgEntity = { type: typed["@type"] ?? "unknown", raw: it };
        if (typed.name !== undefined) entity.name = typed.name;
        if (typed.description !== undefined) entity.description = typed.description;
        out.push(entity);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return out;
}

function parseHeadings($: cheerio.CheerioAPI, level: "h1" | "h2" | "h3", cap = 30): string[] {
  const out: string[] = [];
  $(level).each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && out.length < cap) out.push(text);
  });
  return out;
}

function parseHeroCopy($: cheerio.CheerioAPI): {
  hero?: string;
  subhero?: string;
} {
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  const sub = $("h1").first().nextAll("p, h2").first().text().replace(/\s+/g, " ").trim();
  const out: { hero?: string; subhero?: string } = {};
  if (h1) out.hero = h1;
  if (sub && sub.length < 400) out.subhero = sub;
  return out;
}

function parseNavLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const seen = new Set<string>();
  $("header a, nav a").each((_i, el) => {
    const $el = $(el);
    const label = $el.text().replace(/\s+/g, " ").trim();
    const href = $el.attr("href");
    if (!label || !href) return;
    const resolved = new URL(href, baseUrl).toString();
    const key = `${label}|${resolved}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, href: resolved });
  });
  return out.slice(0, 30);
}

function parsePricing($: cheerio.CheerioAPI): PricingTier[] {
  const tiers: PricingTier[] = [];
  // Heuristic: tier blocks often have class names like "tier", "plan", "pricing-card"
  const candidates = $(
    '[class*="tier"], [class*="plan"], [class*="pricing-card"], [class*="pricing__card"]',
  );
  candidates.slice(0, 8).each((_i, el) => {
    const $el = $(el);
    const name = $el.find("h2, h3, [class*='name']").first().text().replace(/\s+/g, " ").trim();
    if (!name) return;
    const price = $el
      .find('[class*="price"], [class*="amount"]')
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const features: string[] = [];
    $el.find("li").each((__j, li) => {
      const text = $(li).text().replace(/\s+/g, " ").trim();
      if (text) features.push(text);
    });
    const cta = $el.find("a, button").first();
    const ctaLabel = cta.text().replace(/\s+/g, " ").trim();
    const ctaHref = cta.attr("href");
    const tier: PricingTier = { name, features: features.slice(0, 30) };
    if (price) tier.price_display = price;
    if (ctaLabel) tier.cta_label = ctaLabel;
    if (ctaHref) tier.cta_href = ctaHref;
    tiers.push(tier);
  });
  return tiers;
}

function parseFAQ($: cheerio.CheerioAPI): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  $("details, [class*='faq'] [class*='question']")
    .slice(0, 50)
    .each((_i, el) => {
      const $el = $(el);
      const q =
        $el.find("summary").first().text().trim() ||
        $el.find("[class*='question']").first().text().trim() ||
        $el.children().first().text().trim();
      const a = $el.find("p, [class*='answer']").first().text().trim();
      if (q && a) out.push({ q, a: a.slice(0, 500) });
    });
  return out;
}

function parseTestimonials($: cheerio.CheerioAPI): Array<{ quote: string; attribution?: string }> {
  const out: Array<{ quote: string; attribution?: string }> = [];
  $("blockquote, [class*='testimonial'], [class*='review']")
    .slice(0, 20)
    .each((_i, el) => {
      const $el = $(el);
      const quote =
        $el.find("p, q").first().text().replace(/\s+/g, " ").trim() ||
        $el.text().replace(/\s+/g, " ").trim();
      const attribution = $el
        .find("cite, [class*='author'], [class*='name']")
        .first()
        .text()
        .trim();
      if (!quote || quote.length < 20) return;
      const entry: { quote: string; attribution?: string } = { quote: quote.slice(0, 500) };
      if (attribution) entry.attribution = attribution;
      out.push(entry);
    });
  return out;
}

export function parseSurfaceHtml(
  html: string,
  url: string,
  status: number,
  hint?: SurfaceKind,
): SurfaceDocument {
  const $ = cheerio.load(html);
  const h1 = parseHeadings($, "h1", 8);
  const h2 = parseHeadings($, "h2", 30);
  const h3 = parseHeadings($, "h3", 30);
  const hero = parseHeroCopy($);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const excerpt = text.slice(0, 4000);
  const wordCount = text ? text.split(/\s+/).length : 0;

  const doc: SurfaceDocument = {
    url,
    kind: hint ?? classifySurface(url, h1),
    fetched_at: new Date().toISOString(),
    status,
    meta: parseMeta($),
    h1,
    h2,
    h3,
    ctas: parseCTAs($, url),
    nav_links: parseNavLinks($, url),
    schema_org: parseSchemaOrg($),
    pricing_tiers: parsePricing($),
    faq: parseFAQ($),
    testimonials: parseTestimonials($),
    text_excerpt: excerpt,
    word_count: wordCount,
  };
  if (hero.hero !== undefined) doc.hero_copy = hero.hero;
  if (hero.subhero !== undefined) doc.subhero_copy = hero.subhero;
  return doc;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function fetchRobotsTxt(startUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const u = new URL("/robots.txt", startUrl).toString();
    const { body, status } = await fetchWithTimeout(u, 5_000, fetchImpl);
    if (status !== 200) return null;
    return body;
  } catch {
    return null;
  }
}

export function isPathAllowed(robotsTxt: string | null, pathName: string): boolean {
  if (!robotsTxt) return true;
  const lines = robotsTxt.split(/\r?\n/);
  let inStarAgent = false;
  const rules: Array<{ rule: "allow" | "disallow"; prefix: string }> = [];
  for (const raw of lines) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k?.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      inStarAgent = val === "*";
      continue;
    }
    if (!inStarAgent) continue;
    if ((key === "disallow" || key === "allow") && val) {
      rules.push({ rule: key, prefix: val });
    }
  }
  // Most-specific (longest prefix) wins; Allow beats Disallow at equal length.
  let best: { rule: "allow" | "disallow"; prefix: string } | null = null;
  for (const r of rules) {
    if (!pathName.startsWith(r.prefix)) continue;
    if (!best) {
      best = r;
      continue;
    }
    if (r.prefix.length > best.prefix.length) best = r;
    else if (r.prefix.length === best.prefix.length && r.rule === "allow") best = r;
  }
  if (!best) return true;
  return best.rule === "allow";
}

export async function scrapeMarketingSurfaces(
  startUrl: string,
  opts: ScrapeOptions = {},
): Promise<ScrapedSurfaces> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.perRequestTimeoutMs ?? 15_000;
  const maxPages = opts.maxPages ?? 12;
  const respectRobots = opts.respectRobots ?? true;

  const start = new URL(startUrl);
  const notes: string[] = [];

  let robotsTxt: string | null = null;
  if (respectRobots) {
    robotsTxt = await fetchRobotsTxt(startUrl, fetchImpl);
    if (!robotsTxt) notes.push("robots.txt not found or unreachable — proceeding");
  }

  const queue: Array<{ url: string; hint?: SurfaceKind }> = [
    { url: start.toString(), hint: "landing" },
  ];
  // seed with common surfaces
  for (const { path, kind } of CANDIDATE_PATHS) {
    queue.push({ url: new URL(path, start).toString(), hint: kind });
  }

  const visited = new Set<string>();
  const surfaces: SurfaceDocument[] = [];

  for (const entry of queue) {
    if (surfaces.length >= maxPages) break;
    if (visited.has(entry.url)) continue;
    visited.add(entry.url);

    const pathName = new URL(entry.url).pathname;
    if (!isPathAllowed(robotsTxt, pathName)) {
      notes.push(`robots.txt disallows ${pathName} — skipped`);
      continue;
    }

    let resp: { status: number; body: string };
    try {
      resp = await fetchWithTimeout(entry.url, timeoutMs, fetchImpl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      notes.push(`fetch failed for ${entry.url}: ${msg}`);
      continue;
    }
    if (resp.status >= 400) {
      notes.push(`${entry.url} returned ${resp.status} — skipped`);
      continue;
    }
    const doc = parseSurfaceHtml(resp.body, entry.url, resp.status, entry.hint);
    surfaces.push(doc);

    // Polite delay between requests.
    await new Promise((r) => setTimeout(r, 250));
  }

  const obj: ScrapedSurfaces = {
    schema_version: 1,
    start_url: startUrl,
    scraped_at: new Date().toISOString(),
    surfaces,
    ...(notes.length > 0 ? { notes } : {}),
  };
  return ScrapedSurfacesSchema.parse(obj);
}
