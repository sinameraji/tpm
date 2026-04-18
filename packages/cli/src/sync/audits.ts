import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadTokens } from "../auth/tokens.js";

export interface AuditSyncConfig {
  endpoint: string;
  fetchImpl?: typeof fetch;
  homeDir?: string;
}

export class AuditSync {
  private readonly fetchImpl: typeof fetch;
  private readonly homeDir: string;
  constructor(private readonly config: AuditSyncConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.homeDir = config.homeDir ?? os.homedir();
  }

  private bearer(): string {
    const t = loadTokens(this.homeDir);
    if (!t) throw new Error("no access token");
    return `Bearer ${t.access_token}`;
  }

  async createAudit(params: {
    auditId: string;
    target: string;
    tpmVersion: string;
    sessionId: string;
  }): Promise<{ r2_prefix: string }> {
    const res = await this.fetchImpl(new URL("/audits", this.config.endpoint).toString(), {
      method: "POST",
      headers: { authorization: this.bearer(), "content-type": "application/json" },
      body: JSON.stringify({
        audit_id: params.auditId,
        target: params.target,
        tpm_version: params.tpmVersion,
        session_id: params.sessionId,
      }),
    });
    if (!res.ok) {
      if (res.status === 403) return { r2_prefix: "" }; // free tier: skip silently
      throw new Error(`audit create failed ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as { r2_prefix: string };
  }

  async finishAudit(params: {
    auditId: string;
    status: "succeeded" | "failed" | "canceled";
    totalNeurons?: number;
    costPerStage?: Record<string, number>;
  }): Promise<void> {
    const res = await this.fetchImpl(
      new URL(`/audits/${params.auditId}`, this.config.endpoint).toString(),
      {
        method: "PATCH",
        headers: { authorization: this.bearer(), "content-type": "application/json" },
        body: JSON.stringify({
          status: params.status,
          total_neurons: params.totalNeurons,
          cost_per_stage: params.costPerStage,
        }),
      },
    );
    if (!res.ok && res.status !== 403) {
      throw new Error(`audit finish failed ${res.status}: ${await res.text()}`);
    }
  }

  async uploadArtifacts(auditId: string, artifactsDir: string): Promise<number> {
    let count = 0;
    const files = collectFiles(artifactsDir);
    for (const absPath of files) {
      const relName = path.relative(artifactsDir, absPath).replace(/\\/g, "/");
      const body = fs.readFileSync(absPath);
      const res = await this.fetchImpl(
        new URL(`/audits/${auditId}/artifacts/${relName}`, this.config.endpoint).toString(),
        {
          method: "PUT",
          headers: {
            authorization: this.bearer(),
            "content-type": inferContentType(relName),
          },
          body,
        },
      );
      if (res.ok) count += 1;
      else if (res.status !== 403) throw new Error(`upload ${relName} failed ${res.status}`);
    }
    return count;
  }

  async listAudits(): Promise<
    Array<{
      id: string;
      target: string;
      started_at: string;
      ended_at: string | null;
      status: string;
    }>
  > {
    const res = await this.fetchImpl(new URL("/audits", this.config.endpoint).toString(), {
      headers: { authorization: this.bearer() },
    });
    if (!res.ok) throw new Error(`listAudits ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      audits: Array<{
        id: string;
        target: string;
        started_at: string;
        ended_at: string | null;
        status: string;
      }>;
    };
    return body.audits;
  }
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function inferContentType(name: string): string {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "application/yaml";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".html")) return "text/html";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
