import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatSelfHostMessage, QuotaClient } from "./quota.js";
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
          mode: "hosted_trial",
          limit: 1,
          used: 0,
          remaining: 1,
          allowances: { full_audit: true, quick_audit: true },
          self_host: null,
        }),
        { status: 200 },
      );
    };
    const client = new QuotaClient({
      endpoint: "https://tpm-api.sina-b35.workers.dev",
      fetchImpl,
      homeDir: home,
    });
    const status = await client.check();
    expect(status.mode).toBe("hosted_trial");
    expect(status.allowances.full_audit).toBe(true);
    const headers = seen && ((seen as RequestInit).headers as Record<string, string>);
    expect(headers?.authorization ?? headers?.Authorization).toBe("Bearer a");
  });

  it("auto-registers the device when no local token exists", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      calls.push(url);
      if (url.endsWith("/device/register")) {
        return new Response(
          JSON.stringify({
            ok: true,
            device_id: "d",
            tier: "free",
            access_token: "fresh",
            refresh_token: "r",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "hosted_trial",
          limit: 1,
          used: 0,
          remaining: 1,
          allowances: { full_audit: true, quick_audit: true },
          self_host: null,
        }),
        { status: 200 },
      );
    };
    const client = new QuotaClient({
      endpoint: "https://tpm-api.sina-b35.workers.dev",
      fetchImpl,
      homeDir: home,
    });
    const status = await client.check();
    expect(status.mode).toBe("hosted_trial");
    expect(calls.some((u) => u.endsWith("/device/register"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/quota/check"))).toBe(true);
  });
});

describe("formatSelfHostMessage", () => {
  it("includes the self-host URL + byo config hints", () => {
    const msg = formatSelfHostMessage({
      mode: "hosted_trial",
      limit: 1,
      used: 1,
      remaining: 0,
      allowances: { full_audit: false, quick_audit: true },
      self_host: {
        message: "self-host TPM on your own Cloudflare account",
        url: "https://tpm-d3h.pages.dev/self-host",
      },
    });
    expect(msg).toContain("self-host");
    expect(msg).toContain("tpm config set gateway byo");
    expect(msg).toContain("byo.api_token");
  });
});
