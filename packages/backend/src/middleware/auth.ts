import type { Env } from "../env.js";
import { unauthorized } from "../lib/errors.js";
import { verifyJwt, type JwtPayload } from "../lib/jwt.js";

export interface AuthedRequest {
  deviceId: string;
  tier: "free" | "pro" | "team";
  payload: JwtPayload;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthedRequest> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) throw unauthorized("missing bearer token");

  const { valid, payload, reason } = await verifyJwt(match[1], env.JWT_SECRET);
  if (!valid || !payload) throw unauthorized(reason ?? "invalid token");
  if (payload.typ !== "access") throw unauthorized("wrong token type");
  const tier = (payload.tier as "free" | "pro" | "team" | undefined) ?? "free";
  return { deviceId: payload.sub, tier, payload };
}
