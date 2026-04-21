import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { userPaths, ensureDir } from "./paths.js";

// One-shot migration from the old ~/.tpm/ directory (used by
// 1.2.0-beta.1 through 1.2.0-beta.14) to ~/.pm/. Copies config.yaml
// over so users who configured their Anthropic key pre-rename don't
// get re-prompted on the first `pm audit`. Idempotent: if ~/.pm/
// already exists, no-op. Leaves ~/.tpm/ on disk untouched — user
// decides when to delete it.
function migrateUserConfigFromTpm(homeDir: string): void {
  const newRoot = path.join(homeDir, ".pm");
  if (fs.existsSync(newRoot)) return;
  const oldRoot = path.join(homeDir, ".tpm");
  const oldConfig = path.join(oldRoot, "config.yaml");
  if (!fs.existsSync(oldConfig)) return;
  try {
    ensureDir(newRoot, 0o700);
    fs.copyFileSync(oldConfig, path.join(newRoot, "config.yaml"));
    fs.chmodSync(path.join(newRoot, "config.yaml"), 0o600);
  } catch {
    /* best-effort; if copy fails loadConfig will just return DEFAULT */
  }
}

export type ModelTier = "fast" | "deep";

// Flat map keyed by the same identifiers the orchestrator passes to
// the stage-runner. Any subset may be present; absent keys fall back
// to the model tier's default in core/model-tiers.ts.
//
// Known keys (kept as a const array so `tpm config set` can validate
// the key without importing the stage module):
export const STAGE_MODEL_KEYS = [
  "a",
  "b-classify",
  "b-model",
  "b-walk",
  "c",
  "d",
  "e-spec",
  "e-proto",
  "f",
] as const;
export type StageModelKey = (typeof STAGE_MODEL_KEYS)[number];
export type StageModelOverrides = Partial<Record<StageModelKey, string>>;

// v1.2.0 shape. Previous keys (gateway, api_endpoint, byo.*) are
// READ tolerantly from disk for one release so existing 1.1.x users
// don't hard-crash on upgrade, but they're no longer honored — see
// detectLegacyConfig() for the upgrade-prompt path.
export interface UserConfig {
  schema_version: 1;
  anthropic_api_key?: string;
  model_tier: ModelTier;
  stage_models?: StageModelOverrides;
  // Deprecated 1.1.x keys, kept optional so a stale config.yaml
  // doesn't break `loadConfig`. Not written by this version.
  legacy?: {
    gateway?: string;
    api_endpoint?: string;
    byo?: {
      account_id?: string;
      api_token?: string;
      models?: Record<string, string>;
    };
  };
}

const DEFAULT: UserConfig = {
  schema_version: 1,
  model_tier: "fast",
};

// ---- key normalization -----------------------------------------------
//
// The brief chose flat keys for ergonomics (`tpm config set
// stage_models.c claude-opus-4-7`). We also accept a few friendly
// aliases so users don't have to remember the underscored form:
//   - anthropic-key / anthropic_api_key
//   - model-tier    / model_tier
const KEY_ALIASES: Record<string, string> = {
  "anthropic-key": "anthropic_api_key",
  "anthropic-api-key": "anthropic_api_key",
  "model-tier": "model_tier",
};

function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

function isStageModelKey(k: string): k is StageModelKey {
  return (STAGE_MODEL_KEYS as readonly string[]).includes(k);
}

function parseStageModelsKey(key: string): StageModelKey | null {
  // stage_models.c, stage_models.b-model, etc.
  const prefix = "stage_models.";
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return isStageModelKey(rest) ? rest : null;
}

// ---- load / save -----------------------------------------------------

export function loadConfig(homeDir: string = os.homedir()): UserConfig {
  migrateUserConfigFromTpm(homeDir);
  const p = userPaths(homeDir).configYaml;
  if (!fs.existsSync(p)) return structuredClone(DEFAULT);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT);

    const cfg: UserConfig = {
      schema_version: 1,
      model_tier:
        parsed.model_tier === "deep" ? "deep" : parsed.model_tier === "fast" ? "fast" : "fast",
    };

    if (typeof parsed.anthropic_api_key === "string" && parsed.anthropic_api_key.trim()) {
      cfg.anthropic_api_key = parsed.anthropic_api_key;
    }

    if (parsed.stage_models && typeof parsed.stage_models === "object") {
      const overrides: StageModelOverrides = {};
      for (const [k, v] of Object.entries(parsed.stage_models as Record<string, unknown>)) {
        if (isStageModelKey(k) && typeof v === "string" && v.trim()) {
          overrides[k] = v;
        }
      }
      if (Object.keys(overrides).length > 0) cfg.stage_models = overrides;
    }

    // Read legacy keys (1.1.x) tolerantly so loading doesn't throw on
    // an old config.yaml. detectLegacyConfig() surfaces this to the
    // CLI so the user gets the upgrade prompt instead of a crash.
    const legacy: NonNullable<UserConfig["legacy"]> = {};
    if (typeof parsed.gateway === "string") legacy.gateway = parsed.gateway;
    if (typeof parsed.api_endpoint === "string") legacy.api_endpoint = parsed.api_endpoint;
    if (parsed.byo && typeof parsed.byo === "object") {
      const byo = parsed.byo as Record<string, unknown>;
      const lbyo: NonNullable<NonNullable<UserConfig["legacy"]>["byo"]> = {};
      if (typeof byo.account_id === "string") lbyo.account_id = byo.account_id;
      if (typeof byo.api_token === "string") lbyo.api_token = byo.api_token;
      if (byo.models && typeof byo.models === "object") {
        lbyo.models = {};
        for (const [k, v] of Object.entries(byo.models as Record<string, unknown>)) {
          if (typeof v === "string") lbyo.models[k] = v;
        }
      }
      if (Object.keys(lbyo).length > 0) legacy.byo = lbyo;
    }
    if (Object.keys(legacy).length > 0) cfg.legacy = legacy;

    return cfg;
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function saveConfig(cfg: UserConfig, homeDir: string = os.homedir()): void {
  const paths = userPaths(homeDir);
  ensureDir(paths.root, 0o700);
  // Never persist the `legacy` block — it's read-only for detection.
  const toWrite: Record<string, unknown> = {
    schema_version: cfg.schema_version,
    model_tier: cfg.model_tier,
  };
  if (cfg.anthropic_api_key) toWrite.anthropic_api_key = cfg.anthropic_api_key;
  if (cfg.stage_models && Object.keys(cfg.stage_models).length > 0) {
    toWrite.stage_models = cfg.stage_models;
  }
  fs.writeFileSync(paths.configYaml, yaml.dump(toWrite, { noRefs: true, lineWidth: 120 }), {
    mode: 0o600,
  });
}

// ---- API key resolution (env wins) -----------------------------------

export function resolveAnthropicKey(
  cfg: UserConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return cfg.anthropic_api_key?.trim() || undefined;
}

// ---- set / get / unset ----------------------------------------------

export function setConfigValue(cfg: UserConfig, rawKey: string, value: string): UserConfig {
  const key = normalizeKey(rawKey);
  const next = structuredClone(cfg);

  if (key === "anthropic_api_key") {
    if (!value.trim()) throw new Error("anthropic_api_key cannot be empty");
    next.anthropic_api_key = value.trim();
    return next;
  }
  if (key === "model_tier") {
    if (value !== "fast" && value !== "deep") {
      throw new Error("model_tier must be 'fast' or 'deep'");
    }
    next.model_tier = value;
    return next;
  }
  const stageKey = parseStageModelsKey(key);
  if (stageKey) {
    next.stage_models = { ...(next.stage_models ?? {}), [stageKey]: value };
    return next;
  }
  throw new Error(`unknown config key: ${rawKey}`);
}

export function unsetConfigValue(cfg: UserConfig, rawKey: string): UserConfig {
  const key = normalizeKey(rawKey);
  const next = structuredClone(cfg);

  if (key === "anthropic_api_key") {
    delete next.anthropic_api_key;
    return next;
  }
  if (key === "model_tier") {
    // model_tier always has a value — reset to default rather than
    // leave the field undefined.
    next.model_tier = "fast";
    return next;
  }
  const stageKey = parseStageModelsKey(key);
  if (stageKey) {
    if (next.stage_models) {
      delete next.stage_models[stageKey];
      if (Object.keys(next.stage_models).length === 0) delete next.stage_models;
    }
    return next;
  }
  throw new Error(`unknown config key: ${rawKey}`);
}

export function getConfigValue(cfg: UserConfig, rawKey: string): string | undefined {
  const key = normalizeKey(rawKey);
  if (key === "anthropic_api_key") return maskKey(cfg.anthropic_api_key);
  if (key === "model_tier") return cfg.model_tier;
  const stageKey = parseStageModelsKey(key);
  if (stageKey) return cfg.stage_models?.[stageKey];
  throw new Error(`unknown config key: ${rawKey}`);
}

// ---- summaries / masking -------------------------------------------

function maskKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  // Anthropic keys start with `sk-ant-…`. Preserve the prefix so the
  // user can confirm at a glance, and show the last 4. Anything shorter
  // than 10 chars is too short to mask informatively — show a generic
  // hash.
  if (key.length < 10) return "****";
  const prefix = key.startsWith("sk-ant-") ? "sk-ant-" : key.slice(0, 4);
  return `${prefix}…${key.slice(-4)}`;
}

export interface ConfigSummary {
  schema_version: 1;
  model_tier: ModelTier;
  anthropic_api_key: string | null; // masked or null
  stage_models: StageModelOverrides | null;
  legacy_detected: boolean;
}

export function configSummary(cfg: UserConfig): ConfigSummary {
  return {
    schema_version: cfg.schema_version,
    model_tier: cfg.model_tier,
    anthropic_api_key: maskKey(cfg.anthropic_api_key) ?? null,
    stage_models:
      cfg.stage_models && Object.keys(cfg.stage_models).length > 0 ? cfg.stage_models : null,
    legacy_detected: detectLegacyConfig(cfg),
  };
}

// Returns true if the loaded config has 1.1.x-era keys that are no
// longer honored. `tpm audit` uses this to decide whether to show
// the upgrade prompt / migration note (see C12 for the wiring).
export function detectLegacyConfig(cfg: UserConfig): boolean {
  const l = cfg.legacy;
  if (!l) return false;
  if (l.gateway || l.api_endpoint) return true;
  if (l.byo && (l.byo.account_id || l.byo.api_token || l.byo.models)) return true;
  return false;
}
