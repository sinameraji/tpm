import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import {
  configSummary,
  detectLegacyConfig,
  getConfigValue,
  loadConfig,
  resolveAnthropicKey,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from "./config.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tpm-cfg-"));
}

// Writes an in-place .pm/config.yaml with pre-1.2.0-era keys (gateway,
// api_endpoint, byo.*) so detectLegacyConfig sees them. (Previously this
// wrote to .tpm/, but after the 1.2.0-beta.15 rename the primary path
// is .pm/. The migration from .tpm/ → .pm/ is tested separately.)
function writeLegacyConfigFile(home: string, body: unknown): void {
  const dir = path.join(home, ".pm");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.yaml"), yaml.dump(body));
}

describe("config", () => {
  it("loads defaults when no file exists", () => {
    const cfg = loadConfig(tempHome());
    expect(cfg.model_tier).toBe("fast");
    expect(cfg.anthropic_api_key).toBeUndefined();
    expect(cfg.stage_models).toBeUndefined();
    expect(detectLegacyConfig(cfg)).toBe(false);
  });

  it("set → save → load round trip (anthropic key + tier + stage overrides)", () => {
    const home = tempHome();
    let cfg = loadConfig(home);
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-abc123XYZ");
    cfg = setConfigValue(cfg, "model-tier", "deep");
    cfg = setConfigValue(cfg, "stage_models.c", "claude-opus-4-7");
    cfg = setConfigValue(cfg, "stage_models.f", "claude-opus-4-7");
    saveConfig(cfg, home);

    const reloaded = loadConfig(home);
    expect(reloaded.anthropic_api_key).toBe("sk-ant-abc123XYZ");
    expect(reloaded.model_tier).toBe("deep");
    expect(reloaded.stage_models).toEqual({
      c: "claude-opus-4-7",
      f: "claude-opus-4-7",
    });
  });

  it("unset removes key / stage override / resets tier", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-xyz");
    cfg = setConfigValue(cfg, "model-tier", "deep");
    cfg = setConfigValue(cfg, "stage_models.c", "claude-opus-4-7");

    cfg = unsetConfigValue(cfg, "anthropic-key");
    expect(cfg.anthropic_api_key).toBeUndefined();

    cfg = unsetConfigValue(cfg, "stage_models.c");
    expect(cfg.stage_models).toBeUndefined();

    cfg = unsetConfigValue(cfg, "model-tier");
    expect(cfg.model_tier).toBe("fast");
  });

  it("rejects invalid model_tier value", () => {
    const cfg = loadConfig(tempHome());
    expect(() => setConfigValue(cfg, "model-tier", "turbo")).toThrow(/fast.*deep/);
  });

  it("rejects unknown keys", () => {
    const cfg = loadConfig(tempHome());
    expect(() => setConfigValue(cfg, "weird.thing", "x")).toThrow(/unknown/);
    expect(() => setConfigValue(cfg, "stage_models.z", "x")).toThrow(/unknown/);
  });

  it("rejects empty anthropic key", () => {
    const cfg = loadConfig(tempHome());
    expect(() => setConfigValue(cfg, "anthropic-key", "   ")).toThrow(/empty/);
  });

  it("get masks anthropic_api_key preserving the sk-ant- prefix", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-abcdefghijklmnopXYZ9");
    const masked = getConfigValue(cfg, "anthropic-key");
    expect(masked).toMatch(/^sk-ant-…/);
    expect(masked).toContain("XYZ9");
    expect(masked).not.toContain("abcdef");
  });

  it("configSummary masks the key and reports legacy=false for fresh configs", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-abcdefghijklmnopXYZ9");
    const s = configSummary(cfg);
    expect(s.anthropic_api_key).toMatch(/^sk-ant-…/);
    expect(s.legacy_detected).toBe(false);
  });
});

describe("resolveAnthropicKey", () => {
  it("env wins over config", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-from-config");
    expect(resolveAnthropicKey(cfg, { ANTHROPIC_API_KEY: "sk-ant-from-env" })).toBe(
      "sk-ant-from-env",
    );
  });

  it("falls back to config when env is unset", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-from-config");
    expect(resolveAnthropicKey(cfg, {})).toBe("sk-ant-from-config");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveAnthropicKey(loadConfig(tempHome()), {})).toBeUndefined();
  });

  it("treats whitespace-only env as unset", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "anthropic-key", "sk-ant-from-config");
    expect(resolveAnthropicKey(cfg, { ANTHROPIC_API_KEY: "   " })).toBe("sk-ant-from-config");
  });
});

describe("legacy detection", () => {
  it("flags a 1.1.x config.yaml", () => {
    const home = tempHome();
    writeLegacyConfigFile(home, {
      schema_version: 1,
      gateway: "hosted",
      api_endpoint: "https://tpm-api.sina-b35.workers.dev",
      byo: {
        account_id: "acc",
        api_token: "tok",
      },
    });
    const cfg = loadConfig(home);
    expect(detectLegacyConfig(cfg)).toBe(true);
    // New fields take their defaults on a purely-legacy file.
    expect(cfg.model_tier).toBe("fast");
    expect(cfg.anthropic_api_key).toBeUndefined();
  });

  it("does not flag a config that only has the new keys", () => {
    const home = tempHome();
    writeLegacyConfigFile(home, {
      schema_version: 1,
      model_tier: "deep",
      anthropic_api_key: "sk-ant-real",
    });
    const cfg = loadConfig(home);
    expect(detectLegacyConfig(cfg)).toBe(false);
  });

  it("saveConfig does NOT persist the legacy block", () => {
    const home = tempHome();
    writeLegacyConfigFile(home, {
      schema_version: 1,
      gateway: "hosted",
      api_endpoint: "https://tpm-api.example",
      model_tier: "fast",
    });
    const cfg = loadConfig(home);
    expect(detectLegacyConfig(cfg)).toBe(true);
    saveConfig(cfg, home);
    const rewritten = yaml.load(
      fs.readFileSync(path.join(home, ".pm", "config.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(rewritten.gateway).toBeUndefined();
    expect(rewritten.api_endpoint).toBeUndefined();
    expect(rewritten.byo).toBeUndefined();
  });
});
