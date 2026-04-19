// HS256 JWT with the Web Crypto API — no deps, runs in Workers.

export interface JwtPayload {
  sub: string; // device id
  iat: number;
  exp: number;
  typ?: "access" | "refresh";
  [k: string]: unknown;
}

const TEXT = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(str: string): string {
  return b64url(TEXT.encode(str));
}

function b64urlDecode(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const s = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    TEXT.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlFromString(JSON.stringify(header));
  const p = b64urlFromString(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, TEXT.encode(data)));
  return `${data}.${b64url(sig)}`;
}

export interface VerifyResult {
  valid: boolean;
  payload?: JwtPayload;
  reason?: string;
}

export async function verifyJwt(token: string, secret: string): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [h, p, s] = parts;
  if (h === undefined || p === undefined || s === undefined) {
    return { valid: false, reason: "malformed" };
  }
  const data = `${h}.${p}`;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as JwtPayload;
  } catch {
    return { valid: false, reason: "payload_parse" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now > payload.exp) {
    return { valid: false, reason: "expired" };
  }
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), TEXT.encode(data));
  return ok ? { valid: true, payload } : { valid: false, reason: "bad_signature" };
}

export const TOKEN_TTL_SECONDS = {
  access: 60 * 60 * 24, // 24h
  refresh: 60 * 60 * 24 * 30, // 30d
};

export function issueAccessToken(
  deviceId: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return signJwt(
    {
      sub: deviceId,
      typ: "access",
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_TTL_SECONDS.access,
    },
    secret,
  );
}

export function issueRefreshToken(
  deviceId: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return signJwt(
    {
      sub: deviceId,
      typ: "refresh",
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_TTL_SECONDS.refresh,
    },
    secret,
  );
}
