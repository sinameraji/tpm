import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { userPaths, ensureDir } from "../core/paths.js";

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
