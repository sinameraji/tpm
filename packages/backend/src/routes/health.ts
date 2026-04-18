import type { Env } from "../env.js";

export async function health(_request: Request, env: Env): Promise<Response> {
  return Response.json({
    ok: true,
    env: env.ENV,
    version: env.TPM_API_VERSION,
    now: new Date().toISOString(),
  });
}
