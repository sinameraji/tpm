import { describe, it, expect } from "vitest";
import { parseSurfaceHtml, isPathAllowed, scrapeMarketingSurfaces } from "./scraper.js";

const LANDING = `
<!doctype html>
<html>
<head>
  <title>Jinba — AI workflows for banks</title>
  <meta name="description" content="Bank-grade automation out of the box">
  <meta property="og:title" content="Jinba">
  <meta property="og:description" content="AI workflows that banks can deploy">
  <link rel="canonical" href="https://jinba.ai/">
  <script type="application/ld+json">
  {"@type":"SoftwareApplication","name":"Jinba","description":"Bank-grade workflows"}
  </script>
</head>
<body>
  <header>
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="/features">Features</a>
      <a href="/docs">Docs</a>
      <a href="/blog">Blog</a>
    </nav>
  </header>
  <section class="hero">
    <h1>Bank-grade automation out of the box</h1>
    <p>Start automating in under 10 minutes</p>
    <a href="/demo">Book a demo</a>
    <a href="/signup">Start free trial</a>
  </section>
  <section class="features">
    <h2>Everything you need</h2>
    <h3>Compliance templates</h3>
    <h3>Audit log export</h3>
  </section>
  <blockquote class="testimonial">
    <p>Jinba saved my compliance team 40% of their time</p>
    <cite>Jane Compliance, BigBank</cite>
  </blockquote>
  <details>
    <summary>Is this SOC2 compliant?</summary>
    <p>Yes, we are fully SOC2 Type II certified.</p>
  </details>
</body>
</html>
`;

const PRICING = `
<!doctype html>
<html>
<head><title>Pricing</title></head>
<body>
  <h1>Pricing</h1>
  <div class="plan">
    <h2>Starter</h2>
    <div class="price">$99/mo</div>
    <ul><li>Up to 10 workflows</li><li>Email support</li></ul>
    <a href="/signup?plan=starter">Choose Starter</a>
  </div>
  <div class="plan">
    <h2>Enterprise</h2>
    <div class="price">Contact us</div>
    <ul><li>Unlimited workflows</li><li>Dedicated CSM</li><li>SSO</li></ul>
    <a href="/demo">Book a demo</a>
  </div>
</body>
</html>
`;

describe("parseSurfaceHtml", () => {
  it("extracts meta, h1/h2/h3, CTAs, nav, schema.org, testimonials, FAQ", () => {
    const doc = parseSurfaceHtml(LANDING, "https://jinba.ai/", 200);
    expect(doc.kind).toBe("landing");
    expect(doc.meta.title).toMatch(/Jinba/);
    expect(doc.meta.description).toMatch(/Bank-grade/);
    expect(doc.meta.og_title).toBe("Jinba");
    expect(doc.meta.canonical).toBe("https://jinba.ai/");
    expect(doc.h1).toContain("Bank-grade automation out of the box");
    expect(doc.h2).toContain("Everything you need");
    expect(doc.hero_copy).toBe("Bank-grade automation out of the box");
    expect(doc.subhero_copy).toBe("Start automating in under 10 minutes");
    expect(doc.nav_links.map((n) => n.label)).toEqual(
      expect.arrayContaining(["Pricing", "Features", "Docs", "Blog"]),
    );
    expect(doc.ctas.some((c) => /demo/i.test(c.label))).toBe(true);
    expect(doc.ctas.some((c) => /trial/i.test(c.label))).toBe(true);
    expect(doc.schema_org.some((s) => s.type === "SoftwareApplication")).toBe(true);
    expect(doc.testimonials[0]?.quote).toMatch(/Jinba saved/);
    expect(doc.faq[0]?.q).toMatch(/SOC2/);
  });

  it("extracts pricing tiers with features and CTAs", () => {
    const doc = parseSurfaceHtml(PRICING, "https://jinba.ai/pricing", 200);
    expect(doc.kind).toBe("pricing");
    expect(doc.pricing_tiers).toHaveLength(2);
    const starter = doc.pricing_tiers[0];
    expect(starter?.name).toBe("Starter");
    expect(starter?.price_display).toMatch(/99/);
    expect(starter?.features.length).toBeGreaterThan(0);
    expect(starter?.cta_href).toContain("plan=starter");
  });
});

describe("isPathAllowed (robots.txt)", () => {
  it("allows everything when robots.txt is null", () => {
    expect(isPathAllowed(null, "/anything")).toBe(true);
  });
  it("respects Disallow for *", () => {
    const robots = "User-agent: *\nDisallow: /admin/\nAllow: /";
    expect(isPathAllowed(robots, "/admin/x")).toBe(false);
    expect(isPathAllowed(robots, "/public")).toBe(true);
  });
  it("Allow overrides earlier Disallow on the same prefix", () => {
    const robots = "User-agent: *\nDisallow: /api\nAllow: /api/public";
    expect(isPathAllowed(robots, "/api/private")).toBe(false);
    expect(isPathAllowed(robots, "/api/public")).toBe(true);
  });
});

describe("scrapeMarketingSurfaces", () => {
  it("crawls the seed candidates and classifies kinds", async () => {
    const visited = new Set<string>();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      visited.add(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 404 });
      }
      if (url === "https://example.test/") {
        return new Response(LANDING, { status: 200 });
      }
      if (url === "https://example.test/pricing") {
        return new Response(PRICING, { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const scraped = await scrapeMarketingSurfaces("https://example.test/", {
      fetchImpl,
      maxPages: 5,
      perRequestTimeoutMs: 1_000,
    });
    expect(scraped.schema_version).toBe(1);
    expect(scraped.surfaces.length).toBeGreaterThanOrEqual(2);
    expect(scraped.surfaces.some((s) => s.kind === "landing")).toBe(true);
    expect(scraped.surfaces.some((s) => s.kind === "pricing")).toBe(true);
  });

  it("skips disallowed paths per robots.txt", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      seen.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /pricing\n", { status: 200 });
      }
      return new Response("<html><body><h1>Home</h1></body></html>", { status: 200 });
    };
    const scraped = await scrapeMarketingSurfaces("https://example.test/", {
      fetchImpl,
      maxPages: 5,
    });
    expect(seen.some((u) => u.endsWith("/pricing"))).toBe(false);
    expect((scraped.notes ?? []).some((n) => n.includes("/pricing"))).toBe(true);
  });
});
