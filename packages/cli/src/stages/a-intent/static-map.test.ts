import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildStaticMap, writeMapYaml } from "./static-map.js";

function scaffoldProject(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

describe("buildStaticMap — next.js fixture", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-map-next-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("extracts routes, components, forms, tracking, visible strings", () => {
    scaffoldProject(root, {
      "package.json": JSON.stringify({
        name: "sample-saas",
        version: "0.1.0",
        description: "AI workflows for banks",
        dependencies: { next: "^14.0.0", react: "^18.0.0", mixpanel: "^1.0.0" },
      }),
      "app/page.tsx": `
        export default function Home() {
          return (
            <div>
              <h1>Bank-grade automation out of the box</h1>
              <p>Start automating in under 10 minutes</p>
              <button>Book demo</button>
              <a href="/signup">Start trial</a>
              <nav>
                <a href="/pricing">Pricing</a>
                <a href="/blog">Blog</a>
              </nav>
            </div>
          );
        }
      `,
      "app/signup/page.tsx": `
        export default function Signup() {
          return (
            <form action="/api/signup">
              <input name="email" type="email" required />
              <input name="company" required />
              <input name="role" />
              <button>Create account</button>
            </form>
          );
        }
      `,
      "app/api/signup/route.ts": `
        export async function POST(req) {
          mixpanel.track('signup_started', { email: body.email });
          return new Response('ok');
        }
      `,
      "middleware.ts": `
        import { requireAuth } from './lib/auth';
        export default requireAuth;
      `,
      "app/dashboard/page.tsx": `
        export default function Dashboard() { return <h1>Your workflows</h1>; }
      `,
    });

    const map = buildStaticMap(root);

    expect(map.framework).toBe("next");
    expect(map.package.name).toBe("sample-saas");
    expect(map.package.dependencies).toContain("next");
    const paths = map.routes.filter((r) => r.kind !== "middleware").map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/signup");
    expect(paths).toContain("/dashboard");
    expect(map.routes.some((r) => r.kind === "middleware")).toBe(true);
    expect(map.routes.some((r) => r.path === "/dashboard" && r.auth_gated)).toBe(true);

    expect(map.components.some((c) => c.name === "Home")).toBe(true);
    expect(map.components.some((c) => c.name === "Signup")).toBe(true);

    expect(map.forms).toHaveLength(1);
    const form = map.forms[0];
    expect(form?.fields.map((f) => f.name).sort()).toEqual(["company", "email", "role"]);
    expect(form?.fields.find((f) => f.name === "email")?.required).toBe(true);
    expect(form?.fields.find((f) => f.name === "role")?.required).toBe(false);

    expect(
      map.tracking_events.some((t) => t.platform === "mixpanel" && t.event === "signup_started"),
    ).toBe(true);

    const h1s = map.visible_strings.filter((v) => v.context === "h1").map((v) => v.text);
    expect(h1s).toContain("Bank-grade automation out of the box");
    const buttons = map.visible_strings.filter((v) => v.context === "button").map((v) => v.text);
    expect(buttons).toContain("Book demo");

    const navHrefs = map.navigation.map((n) => n.href);
    expect(navHrefs).toContain("/pricing");
    expect(navHrefs).toContain("/blog");

    expect(map.auth_providers).toContain("custom_middleware");
    expect(map.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writeMapYaml produces parseable YAML", () => {
    scaffoldProject(root, {
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "app/page.tsx": `export default function Home() { return <h1>Hi</h1>; }`,
    });
    const map = buildStaticMap(root);
    const out = path.join(root, "map.yaml");
    writeMapYaml(map, out);
    const yml = fs.readFileSync(out, "utf8");
    expect(yml).toContain("schema_version: 1");
    expect(yml).toContain("framework: next");
  });
});

describe("buildStaticMap — framework detection", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-map-fw-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects remix", () => {
    scaffoldProject(root, {
      "package.json": JSON.stringify({ dependencies: { "@remix-run/react": "^2" } }),
    });
    expect(buildStaticMap(root).framework).toBe("remix");
  });

  it("detects unknown when empty", () => {
    scaffoldProject(root, { "package.json": "{}" });
    expect(buildStaticMap(root).framework).toBe("unknown");
  });
});
