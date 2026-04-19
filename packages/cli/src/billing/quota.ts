import * as os from "node:os";
import { loadTokens } from "../auth/tokens.js";

export interface QuotaStatus {
  mode: "hosted_trial";
  limit: number;
  used: number;
  remaining: number;
  allowances: { full_audit: boolean; quick_audit: boolean };
  self_host: { message: string; url: string } | null;
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
    if (!tokens) {
      throw new Error("no access token — run `tpm audit` once to register the device");
    }
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

export function formatSelfHostMessage(status: QuotaStatus): string {
  return [
    "✗ Your free hosted audit has been used.",
    "",
    "TPM is open source. Run unlimited audits on your own Cloudflare Workers AI:",
    `  ${status.self_host?.url ?? "https://tpm-d3h.pages.dev/self-host"}`,
    "",
    "Once set up:",
    "  $ tpm config set gateway byo",
    "  $ tpm config set byo.account_id <your-account-id>",
    "  $ tpm config set byo.api_token <your-api-token>",
    "",
    "Or see: $ tpm self-host",
  ].join("\n");
}

export { formatSelfHostMessage as formatUpgradeMessage };
