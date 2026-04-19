import type { Env } from "../env.js";
import { unauthorized } from "../lib/errors.js";
import { verifyJwt, type JwtPayload } from "../lib/jwt.js";

export interface AuthedRequest {
  deviceId: string;
  payload: JwtPayload;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthedRequest> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) throw unauthorized("missing bearer token");

  const { valid, payload, reason } = await verifyJwt(match[1], env.JWT_SECRET);
  if (!valid || !payload) throw unauthorized(reason ?? "invalid token");
  if (payload.typ !== "access") throw unauthorized("wrong token type");
  return { deviceId: payload.sub, payload };
}
