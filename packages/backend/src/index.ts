import type { Env } from "./env.js";
import { HttpError, notFound } from "./lib/errors.js";
import { health } from "./routes/health.js";
import { registerDevice } from "./routes/device.js";
import { validateLicense } from "./routes/license.js";
import { infer } from "./routes/infer.js";
import { checkQuota } from "./routes/quota.js";

type RouteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/health\/?$/, handler: health },
  { method: "POST", pattern: /^\/device\/register\/?$/, handler: registerDevice },
  { method: "GET", pattern: /^\/license\/validate\/?$/, handler: validateLicense },
  { method: "POST", pattern: /^\/infer\/?$/, handler: infer },
  { method: "GET", pattern: /^\/quota\/check\/?$/, handler: checkQuota },
];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  for (const r of ROUTES) {
    if (r.method === request.method && r.pattern.test(url.pathname)) {
      return r.handler(request, env, ctx);
    }
  }
  throw notFound();
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) return err.toResponse();
      const msg = err instanceof Error ? err.message : "internal error";
      return Response.json({ error: { code: "internal", message: msg } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
export type { Env };
