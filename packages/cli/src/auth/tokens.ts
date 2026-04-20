import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { userPaths, ensureDir } from "../core/paths.js";
import { loadOrCreateDevice } from "./device.js";
import { TPM_VERSION } from "@tpm/shared";

export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  tier: "free" | "pro" | "team";
  issued_at: string;
  expires_at: string;
  device_id: string;
}

function tokenPath(homeDir: string = os.homedir()): string {
  return path.join(userPaths(homeDir).root, "tokens.json");
}

export function loadTokens(homeDir: string = os.homedir()): TokenBundle | null {
  const p = tokenPath(homeDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as TokenBundle;
  } catch {
    return null;
  }
}

export function saveTokens(bundle: TokenBundle, homeDir: string = os.homedir()): void {
  const paths = userPaths(homeDir);
  ensureDir(paths.root, 0o700);
  fs.writeFileSync(tokenPath(homeDir), JSON.stringify(bundle, null, 2), { mode: 0o600 });
}

export function isExpiringSoon(bundle: TokenBundle, marginSeconds = 60): boolean {
  return Date.parse(bundle.expires_at) - Date.now() < marginSeconds * 1000;
}

interface RegisterResponse {
  ok: boolean;
  device_id: string;
  tier: "free" | "pro" | "team";
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Returns a live bundle — re-registers the device if no tokens exist
// or the current pair is within 2 minutes of expiry. Used by every
// backend-facing client (gateway, quota, audit sync) so they don't
// each implement their own refresh. Set `force: true` to skip the
// cache entirely — used when a server says 401 Expired despite the
// local token looking fresh (clock skew, server-side revocation).
export async function ensureFreshToken(
  endpoint: string,
  homeDir: string = os.homedir(),
  fetchImpl: typeof fetch = fetch,
  force = false,
): Promise<TokenBundle> {
  if (!force) {
    const existing = loadTokens(homeDir);
    if (existing && !isExpiringSoon(existing, 120)) return existing;
  }

  const device = loadOrCreateDevice(homeDir);
  const url = new URL("/device/register", endpoint);
  const res = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: device.device_id,
      fingerprint_hash: device.fingerprint_hash,
      tpm_version: TPM_VERSION,
    }),
  });
  if (!res.ok) {
    throw new Error(`device_register failed ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as RegisterResponse;
  const issuedAt = new Date();
  const bundle: TokenBundle = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    tier: body.tier,
    device_id: body.device_id,
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + body.expires_in * 1000).toISOString(),
  };
  saveTokens(bundle, homeDir);
  return bundle;
}
