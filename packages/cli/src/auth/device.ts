import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { userPaths, ensureDir } from "../core/paths.js";

export interface DeviceRecord {
  device_id: string;
  created_at: string;
  fingerprint_hash: string;
}

function computeFingerprintHash(): string {
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    String(os.cpus().length),
    os.cpus()[0]?.model ?? "unknown",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export function loadOrCreateDevice(homeDir: string = os.homedir()): DeviceRecord {
  const paths = userPaths(homeDir);
  ensureDir(paths.root, 0o700);

  if (fs.existsSync(paths.deviceJson)) {
    const raw = fs.readFileSync(paths.deviceJson, "utf8");
    const parsed = JSON.parse(raw) as DeviceRecord;
    if (parsed.device_id && parsed.created_at) return parsed;
  }

  const record: DeviceRecord = {
    device_id: uuidv4(),
    created_at: new Date().toISOString(),
    fingerprint_hash: computeFingerprintHash(),
  };
  fs.writeFileSync(paths.deviceJson, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}
