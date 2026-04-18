import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import yaml from "js-yaml";
import type { Map as MapNamespace } from "@tpm/shared";
import { MapSchema } from "@tpm/shared/schemas/map";
import { isCodeFile, walkProject } from "./walker.js";
import {
  detectAuthProviders,
  detectFramework,
  extractComponent,
  extractForms,
  extractNavigation,
  extractTrackingEvents,
  extractVisibleStrings,
  filebasedNextRoute,
  filebasedRemixRoute,
} from "./extractors.js";

export interface BuildMapOptions {
  maxFileBytes?: number;
  maxFiles?: number;
}

export function buildStaticMap(projectRoot: string, opts: BuildMapOptions = {}): MapNamespace.Map {
  const files: Array<{ relPath: string; source: string }> = [];
  const extCounts: Record<string, number> = {};
  const allRelPaths = new Set<string>();

  for (const walked of walkProject(projectRoot, opts)) {
    extCounts[walked.ext] = (extCounts[walked.ext] ?? 0) + 1;
    allRelPaths.add(walked.relPath);
    if (!isCodeFile(walked.ext)) continue;
    try {
      const source = fs.readFileSync(walked.absPath, "utf8");
      files.push({ relPath: walked.relPath, source });
    } catch {
      continue;
    }
  }

  const pkgPath = path.join(projectRoot, "package.json");
  let pkg: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      // leave default empty
    }
  }

  const framework = detectFramework(pkg, allRelPaths);

  const routes: MapNamespace.RouteInfo[] = [];
  const components: MapNamespace.ComponentInfo[] = [];
  const forms: MapNamespace.FormInfo[] = [];
  const navigation: MapNamespace.NavigationItem[] = [];
  const visibleStrings: MapNamespace.VisibleString[] = [];
  const trackingEvents: MapNamespace.TrackingEvent[] = [];

  // Middleware / programmatic route hint: express/hono/fastify .get/.post
  const PROG_ROUTE_RE =
    /(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const f of files) {
    if (framework === "next") {
      const route = filebasedNextRoute(f.relPath);
      if (route) routes.push(route);
    } else if (framework === "remix") {
      const route = filebasedRemixRoute(f.relPath);
      if (route) routes.push(route);
    }
    for (const m of f.source.matchAll(PROG_ROUTE_RE)) {
      const method = m[1]?.toUpperCase() ?? "GET";
      const p = m[2];
      if (!p) continue;
      routes.push({
        path: `${method} ${p}`,
        kind: "programmatic",
        file: f.relPath,
        auth_gated: /\bauth\b|requireAuth|ensureAuth/.test(f.source),
        is_dynamic: /:\w+/.test(p),
      });
    }

    const comp = extractComponent(f.source, f.relPath);
    if (comp) components.push(comp);

    forms.push(...extractForms(f.source, f.relPath));
    navigation.push(...extractNavigation(f.source, f.relPath));
    visibleStrings.push(...extractVisibleStrings(f.source, f.relPath));
    trackingEvents.push(...extractTrackingEvents(f.source, f.relPath));

    if (
      /middleware\.(ts|js)$/.test(f.relPath) ||
      /app\/api\/auth/.test(f.relPath) ||
      /\brequireAuth\b|\bisAuthenticated\b/.test(f.source)
    ) {
      routes.push({
        path: f.relPath,
        kind: "middleware",
        file: f.relPath,
        auth_gated: true,
        is_dynamic: false,
      });
    }
  }

  const authProviders = detectAuthProviders(files);

  const packageMeta: MapNamespace.Map["package"] = {
    dependencies: Object.keys(pkg.dependencies ?? {}),
    dev_dependencies: Object.keys(pkg.devDependencies ?? {}),
    scripts: pkg.scripts ?? {},
  };
  if (pkg.name !== undefined) packageMeta.name = pkg.name;
  if (pkg.version !== undefined) packageMeta.version = pkg.version;
  if (pkg.description !== undefined) packageMeta.description = pkg.description;

  const map: MapNamespace.Map = {
    schema_version: 1,
    project_path: projectRoot,
    generated_at: new Date().toISOString(),
    content_hash: "", // filled below
    framework,
    package: packageMeta,
    routes: dedupe(routes, (r) => `${r.kind}:${r.path}:${r.file}`),
    components: dedupe(components, (c) => `${c.name}:${c.file}`),
    forms,
    navigation: dedupe(navigation, (n) => `${n.label}:${n.href ?? ""}`).slice(0, 200),
    visible_strings: dedupe(visibleStrings, (v) => `${v.context}:${v.text}:${v.file}`).slice(
      0,
      500,
    ),
    tracking_events: dedupe(trackingEvents, (t) => `${t.platform}:${t.event}:${t.file}`),
    auth_providers: authProviders.length > 0 ? authProviders : ["none"],
    file_count_by_ext: extCounts,
  };

  map.content_hash = hashMap(map);
  return MapSchema.parse(map);
}

function dedupe<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function hashMap(map: MapNamespace.Map): string {
  const stable = JSON.stringify(
    {
      routes: map.routes,
      components: map.components.map((c) => c.name),
      forms: map.forms.length,
      tracking_events: map.tracking_events.map((t) => `${t.platform}:${t.event}`).sort(),
      framework: map.framework,
    },
    null,
    0,
  );
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export function writeMapYaml(map: MapNamespace.Map, outPath: string): void {
  fs.writeFileSync(outPath, yaml.dump(map, { noRefs: true, lineWidth: 120 }));
}
