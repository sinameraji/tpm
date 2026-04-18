import * as os from "node:os";
import { loadTokens } from "../auth/tokens.js";

export interface BillingClientConfig {
  endpoint: string;
  fetchImpl?: typeof fetch;
  homeDir?: string;
}

export class BillingClient {
  private readonly fetchImpl: typeof fetch;
  private readonly homeDir: string;

  constructor(private readonly config: BillingClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.homeDir = config.homeDir ?? os.homedir();
  }

  private bearer(): string {
    const t = loadTokens(this.homeDir);
    if (!t) throw new Error("no access token — run `tpm audit` once to register");
    return `Bearer ${t.access_token}`;
  }

  async checkout(
    tier: "pro" | "team",
    seatCount = 1,
  ): Promise<{ url: string; session_id: string }> {
    const res = await this.fetchImpl(
      new URL("/billing/checkout", this.config.endpoint).toString(),
      {
        method: "POST",
        headers: { authorization: this.bearer(), "content-type": "application/json" },
        body: JSON.stringify({ tier, seat_count: seatCount }),
      },
    );
    if (!res.ok) throw new Error(`checkout failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { url: string; session_id: string };
  }

  async portal(): Promise<{ url: string }> {
    const res = await this.fetchImpl(new URL("/billing/portal", this.config.endpoint).toString(), {
      method: "POST",
      headers: { authorization: this.bearer() },
    });
    if (!res.ok) throw new Error(`portal failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { url: string };
  }

  async activate(code: string): Promise<{ tier: string }> {
    const res = await this.fetchImpl(
      new URL("/billing/activate", this.config.endpoint).toString(),
      {
        method: "POST",
        headers: { authorization: this.bearer(), "content-type": "application/json" },
        body: JSON.stringify({ code }),
      },
    );
    if (!res.ok) throw new Error(`activate failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { tier: string };
  }

  async pollDeviceStatus(
    deviceId: string,
    expectedTier: "pro" | "team",
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 2000,
  ): Promise<{ tier: string; status: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.fetchImpl(
        new URL(`/device/${deviceId}/status`, this.config.endpoint).toString(),
      );
      if (res.ok) {
        const body = (await res.json()) as { tier: string; status: string };
        if (body.tier === expectedTier) return body;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }
}
