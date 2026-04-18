import { TPM_VERSION } from "@tpm/shared";

export interface Env {
  // M3 fills in D1, KV, R2, AI, STRIPE_SECRET bindings per wrangler.toml.
  TPM_VERSION_TAG?: string;
}

const worker = {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, version: TPM_VERSION });
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default worker;
