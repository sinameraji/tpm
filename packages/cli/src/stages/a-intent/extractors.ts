import type {
  ComponentInfo,
  FormField,
  FormInfo,
  Framework,
  RouteInfo,
  TrackingEvent,
  VisibleString,
} from "@tpm/shared/schemas/map";

interface NavItem {
  label: string;
  href?: string;
  file: string;
}

const TRACKING_PATTERNS: Array<{
  platform:
    | "mixpanel"
    | "amplitude"
    | "segment"
    | "posthog"
    | "gtag"
    | "dataLayer"
    | "heap"
    | "analytics_js";
  re: RegExp;
}> = [
  { platform: "mixpanel", re: /\bmixpanel\s*\.\s*track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  {
    platform: "amplitude",
    re: /\bamplitude\s*\.\s*(?:logEvent|track)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  },
  { platform: "segment", re: /\banalytics\s*\.\s*track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { platform: "posthog", re: /\bposthog\s*\.\s*capture\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { platform: "gtag", re: /\bgtag\s*\(\s*['"`]event['"`]\s*,\s*['"`]([^'"`]+)['"`]/g },
  {
    platform: "dataLayer",
    re: /\bdataLayer\s*\.\s*push\s*\(\s*\{\s*event\s*:\s*['"`]([^'"`]+)['"`]/g,
  },
  { platform: "heap", re: /\bheap\s*\.\s*track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { platform: "analytics_js", re: /\btrack\s*\(\s*['"`]([^'"`]+)['"`]/g },
];

export function extractTrackingEvents(source: string, file: string): TrackingEvent[] {
  const found: TrackingEvent[] = [];
  for (const { platform, re } of TRACKING_PATTERNS) {
    const iter = source.matchAll(re);
    for (const match of iter) {
      const event = match[1];
      if (!event) continue;
      found.push({ platform, event, file });
    }
  }
  return found;
}

const AUTH_SIGNALS = [
  { provider: "nextauth" as const, patterns: [/getServerSession/, /next-auth/] },
  { provider: "clerk" as const, patterns: [/@clerk\/nextjs/, /clerkClient/, /<ClerkProvider/] },
  { provider: "auth0" as const, patterns: [/@auth0\//, /useAuth0/] },
  { provider: "supabase" as const, patterns: [/@supabase\/auth-helpers/, /supabase\.auth/] },
  { provider: "firebase" as const, patterns: [/firebase\/auth/, /getAuth\(/] },
  { provider: "devise" as const, patterns: [/authenticate_user!/, /devise\s+:/] },
  { provider: "passport" as const, patterns: [/passport\.authenticate/] },
  {
    provider: "custom_middleware" as const,
    patterns: [/\brequireAuth\b/, /\bensureAuth\b/, /\bisAuthenticated\b/],
  },
];

export function detectAuthProviders(
  fileContents: Array<{ source: string }>,
): Array<
  | "nextauth"
  | "clerk"
  | "auth0"
  | "supabase"
  | "firebase"
  | "devise"
  | "passport"
  | "custom_middleware"
> {
  const found = new Set<
    | "nextauth"
    | "clerk"
    | "auth0"
    | "supabase"
    | "firebase"
    | "devise"
    | "passport"
    | "custom_middleware"
  >();
  for (const { source } of fileContents) {
    for (const { provider, patterns } of AUTH_SIGNALS) {
      if (patterns.some((p) => p.test(source))) found.add(provider);
    }
  }
  return [...found];
}

export function detectFramework(
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  fileSet: Set<string>,
): Framework {
  const allDeps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  if ("next" in allDeps) return "next";
  if ("nuxt" in allDeps || "@nuxt/kit" in allDeps) return "nuxt";
  if ("@remix-run/react" in allDeps || "remix" in allDeps) return "remix";
  if ("astro" in allDeps) return "astro";
  if ("svelte" in allDeps || "@sveltejs/kit" in allDeps) return "svelte";
  if ("vue" in allDeps) return "vue";
  if ("react" in allDeps) return "react";
  if ("hono" in allDeps) return "hono";
  if ("fastify" in allDeps) return "fastify";
  if ("express" in allDeps) return "express";
  if (fileSet.has("Gemfile")) return "rails";
  if (fileSet.has("manage.py") || fileSet.has("settings.py")) return "django";
  if ([...fileSet].some((f) => f.endsWith("app.py") || f.endsWith("wsgi.py"))) return "flask";
  return "unknown";
}

export function filebasedNextRoute(relPath: string): RouteInfo | null {
  // app router: app/**/page.(tsx|jsx|ts|js) or app/**/route.(ts|js) for api
  const appPageMatch = /^app\/((?:[^/]+\/)*)(page|route)\.(tsx|ts|jsx|js)$/.exec(relPath);
  if (appPageMatch) {
    const dirPart = appPageMatch[1] ?? "";
    const leaf = appPageMatch[2] ?? "";
    const raw = dirPart.replace(/\/$/, "");
    if (raw.includes("/(") || raw.includes("@")) return null; // parallel/intercept — skip
    const isApi = raw.startsWith("api") || leaf === "route";
    const cleaned = raw.replace(/\/\(.*?\)\//g, "/").replace(/^\(.*?\)\/?/, "");
    const urlPath = cleaned === "" ? "/" : "/" + cleaned;
    return {
      path: urlPath,
      kind: isApi ? "api" : "file_based",
      file: relPath,
      auth_gated: /\(auth\)|\(protected\)|dashboard|admin|account|settings/.test(relPath),
      is_dynamic: /\[.+?\]/.test(relPath),
    };
  }
  // pages router: pages/**.(tsx|jsx|ts|js)
  const pagesMatch = /^pages\/(.+)\.(tsx|ts|jsx|js)$/.exec(relPath);
  if (pagesMatch && pagesMatch[1] !== undefined) {
    const raw = pagesMatch[1].replace(/\/index$/, "");
    if (raw === "_app" || raw === "_document" || raw === "_error") return null;
    const isApi = raw.startsWith("api/");
    return {
      path: "/" + raw.replace(/\/$/, ""),
      kind: isApi ? "api" : "file_based",
      file: relPath,
      auth_gated: /dashboard|admin|account|settings/.test(relPath),
      is_dynamic: /\[.+?\]/.test(relPath),
    };
  }
  return null;
}

export function filebasedRemixRoute(relPath: string): RouteInfo | null {
  const m = /^app\/routes\/(.+)\.(tsx|ts|jsx|js)$/.exec(relPath);
  if (!m || m[1] === undefined) return null;
  const raw = m[1].replace(/\.route$/, "");
  const urlPath = "/" + raw.replace(/\._index$/, "").replace(/\./g, "/");
  return {
    path: urlPath,
    kind: "file_based",
    file: relPath,
    auth_gated: /dashboard|admin|account|settings/.test(relPath),
    is_dynamic: /\$/.test(relPath),
  };
}

const VISIBLE_CONTEXT_RE = /<(h1|h2|h3|button|a|p)\b[^>]*>([^<{][^<]{0,200})<\/\1>/gi;

export function extractVisibleStrings(source: string, file: string): VisibleString[] {
  const out: VisibleString[] = [];
  const iter = source.matchAll(VISIBLE_CONTEXT_RE);
  for (const m of iter) {
    const tag = m[1]?.toLowerCase();
    const text = (m[2] ?? "").trim().replace(/\s+/g, " ");
    if (!text || text.length < 3) continue;
    let ctx: VisibleString["context"] = "other";
    if (tag === "h1") ctx = "h1";
    else if (tag === "h2") ctx = "h2";
    else if (tag === "h3") ctx = "h3";
    else if (tag === "button") ctx = "button";
    else if (tag === "a") ctx = "link";
    else if (tag === "p" && /\b(get|try|start|sign up|book|free|demo|trial)\b/i.test(text))
      ctx = "cta";
    out.push({ text, file, context: ctx });
  }
  return out;
}

const FORM_RE = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_RE =
  /<input\b([^>]*)\/?\s*>|<select\b([^>]*)>[\s\S]*?<\/select>|<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi;
const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]+)\})/g;
const BUTTON_RE = /<button\b[^>]*>([\s\S]*?)<\/button>/i;

function parseAttrs(open: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of open.matchAll(ATTR_RE)) {
    const key = m[1]?.toLowerCase();
    if (!key) continue;
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    out[key] = val;
  }
  return out;
}

export function extractForms(source: string, file: string): FormInfo[] {
  const out: FormInfo[] = [];
  for (const f of source.matchAll(FORM_RE)) {
    const formOpen = f[1] ?? "";
    const inner = f[2] ?? "";
    const formAttrs = parseAttrs(formOpen);
    const fields: FormField[] = [];
    for (const im of inner.matchAll(INPUT_RE)) {
      const open = im[1] ?? im[2] ?? im[3] ?? "";
      const attrs = parseAttrs(open);
      const name = attrs["name"] ?? attrs["id"];
      if (!name) continue;
      const field: FormField = {
        name,
        required: "required" in attrs || /required(\s|\/>|>)/.test(open),
      };
      if (attrs["type"] !== undefined) field.type = attrs["type"];
      if (attrs["placeholder"] !== undefined) field.placeholder = attrs["placeholder"];
      fields.push(field);
    }
    const buttonMatch = BUTTON_RE.exec(inner);
    const submit_label = buttonMatch?.[1]?.replace(/<[^>]+>/g, "").trim();
    const info: FormInfo = {
      file,
      fields,
    };
    if (formAttrs["action"] !== undefined) info.action = formAttrs["action"];
    if (submit_label) info.submit_label = submit_label;
    out.push(info);
  }
  return out;
}

const NAV_LINK_RE =
  /<(?:Link|NavLink|a)\b[^>]*\b(?:href|to)\s*=\s*(?:"([^"]*)"|'([^']*)'|{['"`]([^'"`]+)['"`]})[^>]*>([\s\S]*?)<\/(?:Link|NavLink|a)>/gi;

export function extractNavigation(source: string, file: string): NavItem[] {
  if (!/\bnav\b|<nav|<header|<Header|<Navbar|<NavBar/.test(source)) return [];
  const out: NavItem[] = [];
  for (const m of source.matchAll(NAV_LINK_RE)) {
    const href = m[1] ?? m[2] ?? m[3];
    const label = (m[4] ?? "").replace(/<[^>]+>/g, "").trim();
    if (!label) continue;
    const item: NavItem = { label, file };
    if (href !== undefined) item.href = href;
    out.push(item);
  }
  return out.slice(0, 20);
}

const DEFAULT_EXPORT_RE = /export\s+default\s+(?:function|class)?\s*([A-Z][A-Za-z0-9_]*)\s*[({]/;

export function extractComponent(source: string, file: string): ComponentInfo | null {
  const m = DEFAULT_EXPORT_RE.exec(source);
  if (m) {
    const name = m[1];
    if (!name) return null;
    return { name, file };
  }
  // Vue/Svelte single-file components take their name from the filename.
  if (/\.(vue|svelte)$/.test(file)) {
    const base = file
      .split("/")
      .pop()
      ?.replace(/\.(vue|svelte)$/, "");
    if (base) return { name: base, file };
  }
  return null;
}
