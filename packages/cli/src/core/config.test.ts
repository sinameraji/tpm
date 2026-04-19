import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configSummary, getConfigValue, loadConfig, saveConfig, setConfigValue } from "./config.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tpm-cfg-"));
}

describe("config", () => {
  it("loads defaults when no file exists", () => {
    const cfg = loadConfig(tempHome());
    expect(cfg.gateway).toBe("hosted");
    expect(cfg.api_endpoint).toBe("https://api.usetpm.dev");
  });

  it("set → save → load round trip", () => {
    const home = tempHome();
    let cfg = loadConfig(home);
    cfg = setConfigValue(cfg, "gateway", "byo");
    cfg = setConfigValue(cfg, "byo.account_id", "my-acct");
    cfg = setConfigValue(cfg, "byo.api_token", "secret-token-abc");
    cfg = setConfigValue(cfg, "byo.models.heavy", "@cf/openai/gpt-oss-120b");
    saveConfig(cfg, home);
    const reloaded = loadConfig(home);
    expect(reloaded.gateway).toBe("byo");
    expect(reloaded.byo.account_id).toBe("my-acct");
    expect(reloaded.byo.api_token).toBe("secret-token-abc");
    expect(reloaded.byo.models?.heavy).toBe("@cf/openai/gpt-oss-120b");
  });

  it("rejects invalid gateway value", () => {
    const cfg = loadConfig(tempHome());
    expect(() => setConfigValue(cfg, "gateway", "other")).toThrow(/hosted.*byo/);
  });

  it("rejects unknown keys", () => {
    const cfg = loadConfig(tempHome());
    expect(() => setConfigValue(cfg, "weird.thing", "x")).toThrow(/unknown/);
  });

  it("get masks byo.api_token", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "byo.api_token", "ABCD1234EFGH5678IJKL");
    const masked = getConfigValue(cfg, "byo.api_token");
    expect(masked).toBe("ABCD…IJKL");
  });

  it("configSummary masks the token", () => {
    let cfg = loadConfig(tempHome());
    cfg = setConfigValue(cfg, "byo.api_token", "ABCD1234EFGH5678IJKL");
    const s = configSummary(cfg) as { byo: { api_token?: string } };
    expect(s.byo.api_token).toBe("ABCD…IJKL");
  });
});
