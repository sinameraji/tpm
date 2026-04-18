import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatUpgradeMessage, QuotaClient } from "./quota.js";
import { saveTokens } from "../auth/tokens.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tpm-quota-"));
}

describe("QuotaClient", () => {
  it("hits /quota/check with bearer token", async () => {
    const home = tempHome();
    saveTokens(
      {
        access_token: "a",
        refresh_token: "r",
        tier: "free",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        device_id: "d",
      },
      home,
    );
    let seen: RequestInit | null = null;
    const fetchImpl: typeof fetch = async (_input, init = {}) => {
      seen = init;
      return new Response(
        JSON.stringify({
          ok: true,
          tier: "free",
          quota: { full_audits_lifetime: 1, full_audits_monthly: 0 },
          usage: { full_audits_lifetime: 0, full_audits_this_period: 0 },
          allowances: {
            full_audit: true,
            quick_audit: true,
            remaining_lifetime: 1,
            remaining_monthly: null,
          },
          upgrade_hint: null,
        }),
        { status: 200 },
      );
    };
    const client = new QuotaClient({
      endpoint: "https://api.usetpm.dev",
      fetchImpl,
      homeDir: home,
    });
    const status = await client.check();
    expect(status.tier).toBe("free");
    expect(status.allowances.full_audit).toBe(true);
    const headers = seen && ((seen as RequestInit).headers as Record<string, string>);
    expect(headers?.authorization ?? headers?.Authorization).toBe("Bearer a");
  });

  it("throws a clear error when no token exists", async () => {
    const home = tempHome();
    const client = new QuotaClient({ endpoint: "https://api.usetpm.dev", homeDir: home });
    await expect(client.check()).rejects.toThrow(/no access token/i);
  });
});

describe("formatUpgradeMessage", () => {
  it("includes $20 and $49 pricing lines", () => {
    const msg = formatUpgradeMessage({
      tier: "free",
      allowances: {
        full_audit: false,
        quick_audit: true,
        remaining_lifetime: 0,
        remaining_monthly: null,
      },
      usage: { full_audits_lifetime: 1, full_audits_this_period: 0 },
      upgrade_hint: { message: "upgrade", url: "https://usetpm.dev/upgrade" },
    });
    expect(msg).toContain("$20");
    expect(msg).toContain("$49");
    expect(msg).toContain("tpm upgrade");
  });
});
