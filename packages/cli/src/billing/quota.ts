import * as os from "node:os";
import { loadTokens } from "../auth/tokens.js";

export interface QuotaStatus {
  tier: "free" | "pro" | "team";
  allowances: {
    full_audit: boolean;
    quick_audit: boolean;
    remaining_lifetime: number | null;
    remaining_monthly: number | null;
  };
  usage: {
    full_audits_lifetime: number;
    full_audits_this_period: number;
  };
  upgrade_hint: { message: string; url: string } | null;
}

export interface QuotaClientConfig {
  endpoint: string;
  fetchImpl?: typeof fetch;
  homeDir?: string;
}

export class QuotaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly homeDir: string;
  constructor(private readonly config: QuotaClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.homeDir = config.homeDir ?? os.homedir();
  }

  async check(): Promise<QuotaStatus> {
    const tokens = loadTokens(this.homeDir);
    if (!tokens) throw new Error("no access token — run `tpm audit` once to register the device");
    const res = await this.fetchImpl(new URL("/quota/check", this.config.endpoint).toString(), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`quota/check failed ${res.status}: ${text}`);
    }
    return (await res.json()) as QuotaStatus;
  }
}

export function formatUpgradeMessage(status: QuotaStatus): string {
  return [
    "✗ Full-audit quota exhausted.",
    "",
    "Upgrade to TPM Pro to continue:",
    "  $ tpm upgrade",
    "",
    `Or visit: ${status.upgrade_hint?.url ?? "https://usetpm.dev/upgrade"}`,
    "",
    "Pro   $20/month   20 audits, unlimited re-runs, PDF + prototypes",
    "Team  $49/seat    50 audits/seat, shared patterns, audit history",
  ].join("\n");
}
