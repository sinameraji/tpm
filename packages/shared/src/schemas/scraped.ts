import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const SurfaceKind = z.enum([
  "landing",
  "pricing",
  "features",
  "docs",
  "about",
  "blog",
  "faq",
  "other",
]);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

export const MetaTags = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  og_title: z.string().optional(),
  og_description: z.string().optional(),
  og_type: z.string().optional(),
  twitter_card: z.string().optional(),
  canonical: z.string().optional(),
  robots: z.string().optional(),
});
export type MetaTags = z.infer<typeof MetaTags>;

export const SchemaOrgEntity = z.object({
  type: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  raw: z.unknown(),
});
export type SchemaOrgEntity = z.infer<typeof SchemaOrgEntity>;

export const CTA = z.object({
  label: z.string(),
  href: z.string().optional(),
  prominence: z.enum(["primary", "secondary", "tertiary"]).default("secondary"),
});
export type CTA = z.infer<typeof CTA>;

export const PricingTier = z.object({
  name: z.string(),
  price_display: z.string().optional(),
  features: z.array(z.string()),
  cta_label: z.string().optional(),
  cta_href: z.string().optional(),
});
export type PricingTier = z.infer<typeof PricingTier>;

export const SurfaceDocument = z.object({
  url: z.string(),
  kind: SurfaceKind,
  fetched_at: z.string(),
  status: z.number(),
  meta: MetaTags,
  h1: z.array(z.string()),
  h2: z.array(z.string()),
  h3: z.array(z.string()),
  hero_copy: z.string().optional(),
  subhero_copy: z.string().optional(),
  ctas: z.array(CTA),
  nav_links: z.array(z.object({ label: z.string(), href: z.string() })),
  schema_org: z.array(SchemaOrgEntity),
  pricing_tiers: z.array(PricingTier),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  testimonials: z.array(z.object({ quote: z.string(), attribution: z.string().optional() })),
  text_excerpt: z.string(),
  word_count: z.number(),
});
export type SurfaceDocument = z.infer<typeof SurfaceDocument>;

export const ScrapedSurfacesSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  start_url: z.string(),
  scraped_at: z.string(),
  surfaces: z.array(SurfaceDocument),
  notes: z.array(z.string()).optional(),
});
export type ScrapedSurfaces = z.infer<typeof ScrapedSurfacesSchema>;
