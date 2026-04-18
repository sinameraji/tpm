import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const Framework = z.enum([
  "next",
  "remix",
  "react",
  "vue",
  "svelte",
  "astro",
  "nuxt",
  "rails",
  "django",
  "flask",
  "fastify",
  "express",
  "hono",
  "unknown",
]);
export type Framework = z.infer<typeof Framework>;

export const TrackingPlatform = z.enum([
  "mixpanel",
  "amplitude",
  "segment",
  "posthog",
  "gtag",
  "dataLayer",
  "heap",
  "analytics_js",
  "unknown",
]);
export type TrackingPlatform = z.infer<typeof TrackingPlatform>;

export const AuthProvider = z.enum([
  "nextauth",
  "clerk",
  "auth0",
  "supabase",
  "firebase",
  "devise",
  "passport",
  "custom_middleware",
  "none",
]);
export type AuthProvider = z.infer<typeof AuthProvider>;

export const RouteKind = z.enum(["file_based", "programmatic", "api", "middleware"]);

export const RouteInfo = z.object({
  path: z.string(),
  kind: RouteKind,
  file: z.string(),
  auth_gated: z.boolean(),
  is_dynamic: z.boolean(),
});
export type RouteInfo = z.infer<typeof RouteInfo>;

export const FormField = z.object({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean(),
  placeholder: z.string().optional(),
});
export type FormField = z.infer<typeof FormField>;

export const FormInfo = z.object({
  file: z.string(),
  action: z.string().optional(),
  fields: z.array(FormField),
  submit_label: z.string().optional(),
});
export type FormInfo = z.infer<typeof FormInfo>;

export const ComponentInfo = z.object({
  name: z.string(),
  file: z.string(),
  purpose_hint: z.string().optional(),
});
export type ComponentInfo = z.infer<typeof ComponentInfo>;

export const TrackingEvent = z.object({
  platform: TrackingPlatform,
  event: z.string(),
  file: z.string(),
  props_hint: z.array(z.string()).optional(),
});
export type TrackingEvent = z.infer<typeof TrackingEvent>;

export const VisibleString = z.object({
  text: z.string(),
  file: z.string(),
  context: z.enum(["h1", "h2", "h3", "button", "link", "tagline", "hero", "cta", "other"]),
});
export type VisibleString = z.infer<typeof VisibleString>;

export const PackageMeta = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()),
  dev_dependencies: z.array(z.string()),
  scripts: z.record(z.string(), z.string()),
});

export const NavigationItem = z.object({
  label: z.string(),
  href: z.string().optional(),
  file: z.string(),
});
export type NavigationItem = z.infer<typeof NavigationItem>;

export const MapSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  project_path: z.string(),
  generated_at: z.string(),
  content_hash: z.string(),
  framework: Framework,
  package: PackageMeta,
  routes: z.array(RouteInfo),
  components: z.array(ComponentInfo),
  forms: z.array(FormInfo),
  navigation: z.array(NavigationItem),
  visible_strings: z.array(VisibleString),
  tracking_events: z.array(TrackingEvent),
  auth_providers: z.array(AuthProvider),
  file_count_by_ext: z.record(z.string(), z.number()),
});
export type Map = z.infer<typeof MapSchema>;
