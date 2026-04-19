import * as fs from "node:fs";
import * as os from "node:os";
import yaml from "js-yaml";
import { userPaths, ensureDir } from "./paths.js";

export type GatewayMode = "hosted" | "byo";

export interface UserConfig {
  schema_version: 1;
  gateway: GatewayMode;
  api_endpoint: string;
  byo: {
    account_id?: string;
    api_token?: string;
    models?: {
      heavy?: string;
      navigator?: string;
      prototype?: string;
    };
  };
}

const DEFAULT: UserConfig = {
  schema_version: 1,
  gateway: "hosted",
  api_endpoint: "https://api.usetpm.dev",
  byo: {},
};

export function loadConfig(homeDir: string = os.homedir()): UserConfig {
  const p = userPaths(homeDir).configYaml;
  if (!fs.existsSync(p)) return DEFAULT;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = yaml.load(raw) as Partial<UserConfig> | null;
    if (!parsed) return DEFAULT;
    return {
      schema_version: 1,
      gateway: parsed.gateway === "byo" ? "byo" : "hosted",
      api_endpoint: parsed.api_endpoint ?? DEFAULT.api_endpoint,
      byo: parsed.byo ?? {},
    };
  } catch {
    return DEFAULT;
  }
}

export function saveConfig(cfg: UserConfig, homeDir: string = os.homedir()): void {
  const paths = userPaths(homeDir);
  ensureDir(paths.root, 0o700);
  fs.writeFileSync(paths.configYaml, yaml.dump(cfg, { noRefs: true, lineWidth: 120 }), {
    mode: 0o600,
  });
}

// Dot-path helpers — `gateway`, `byo.account_id`, `byo.models.heavy`, etc.
export function setConfigValue(cfg: UserConfig, key: string, value: string): UserConfig {
  const next = JSON.parse(JSON.stringify(cfg)) as UserConfig;
  const parts = key.split(".");
  if (parts[0] === "gateway") {
    if (value !== "hosted" && value !== "byo") {
      throw new Error("gateway must be 'hosted' or 'byo'");
    }
    next.gateway = value;
    return next;
  }
  if (parts[0] === "api_endpoint") {
    next.api_endpoint = value;
    return next;
  }
  if (parts[0] === "byo") {
    const rest = parts.slice(1).join(".");
    if (rest === "account_id") next.byo.account_id = value;
    else if (rest === "api_token") next.byo.api_token = value;
    else if (rest === "models.heavy") {
      next.byo.models = { ...(next.byo.models ?? {}), heavy: value };
    } else if (rest === "models.navigator") {
      next.byo.models = { ...(next.byo.models ?? {}), navigator: value };
    } else if (rest === "models.prototype") {
      next.byo.models = { ...(next.byo.models ?? {}), prototype: value };
    } else {
      throw new Error(`unknown config key: ${key}`);
    }
    return next;
  }
  throw new Error(`unknown config key: ${key}`);
}

export function getConfigValue(cfg: UserConfig, key: string): string | undefined {
  if (key === "gateway") return cfg.gateway;
  if (key === "api_endpoint") return cfg.api_endpoint;
  if (key === "byo.account_id") return cfg.byo.account_id;
  if (key === "byo.api_token") {
    // Don't print the raw token back. Mask it.
    const t = cfg.byo.api_token;
    return t ? `${t.slice(0, 4)}…${t.slice(-4)}` : undefined;
  }
  if (key === "byo.models.heavy") return cfg.byo.models?.heavy;
  if (key === "byo.models.navigator") return cfg.byo.models?.navigator;
  if (key === "byo.models.prototype") return cfg.byo.models?.prototype;
  throw new Error(`unknown config key: ${key}`);
}

export function configSummary(cfg: UserConfig): Record<string, unknown> {
  return {
    schema_version: cfg.schema_version,
    gateway: cfg.gateway,
    api_endpoint: cfg.api_endpoint,
    byo: {
      account_id: cfg.byo.account_id,
      api_token: cfg.byo.api_token
        ? `${cfg.byo.api_token.slice(0, 4)}…${cfg.byo.api_token.slice(-4)}`
        : undefined,
      models: cfg.byo.models,
    },
  };
}
