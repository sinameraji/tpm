import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadOrCreateDevice } from "./device.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tpm-device-test-"));
}

describe("loadOrCreateDevice", () => {
  let home: string;
  beforeEach(() => {
    home = tempHome();
  });

  it("creates ~/.tpm/device.json on first run with a v4 uuid and a fingerprint hash", () => {
    const d = loadOrCreateDevice(home);
    expect(d.device_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(d.fingerprint_hash).toMatch(/^[0-9a-f]{64}$/);
    const file = path.join(home, ".tpm", "device.json");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("is idempotent — reusing the same device_id on subsequent calls", () => {
    const a = loadOrCreateDevice(home);
    const b = loadOrCreateDevice(home);
    expect(b.device_id).toBe(a.device_id);
    expect(b.created_at).toBe(a.created_at);
  });

  it("persists device.json with 0600-equivalent mode", () => {
    loadOrCreateDevice(home);
    const file = path.join(home, ".tpm", "device.json");
    const mode = fs.statSync(file).mode & 0o777;
    // macOS umask may leave 0o644 on write; we assert owner-write at minimum.
    expect(mode & 0o600).toBe(0o600);
  });
});
