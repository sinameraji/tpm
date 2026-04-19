export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  RATE_LIMITS: KVNamespace;
  ARTIFACTS: R2Bucket;
  AI: Ai;

  JWT_SECRET: string;

  TPM_API_VERSION: string;
  ENV: "production" | "dev" | "test";
}
