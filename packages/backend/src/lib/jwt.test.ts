import { describe, it, expect } from "vitest";
import { issueAccessToken, issueRefreshToken, signJwt, verifyJwt } from "./jwt.js";

const SECRET = "z".repeat(64);

describe("jwt", () => {
  it("round-trips a payload", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = await signJwt(
      { sub: "device-1", iat: now, exp: now + 60, typ: "access", tier: "pro" },
      SECRET,
    );
    const { valid, payload } = await verifyJwt(tok, SECRET);
    expect(valid).toBe(true);
    expect(payload?.sub).toBe("device-1");
    expect(payload?.tier).toBe("pro");
  });

  it("fails verification under the wrong secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = await signJwt({ sub: "d", iat: now, exp: now + 60 }, SECRET);
    const { valid, reason } = await verifyJwt(tok, "different-secret");
    expect(valid).toBe(false);
    expect(reason).toBe("bad_signature");
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = await signJwt({ sub: "d", iat: now - 1000, exp: now - 10 }, SECRET);
    const { valid, reason } = await verifyJwt(tok, SECRET);
    expect(valid).toBe(false);
    expect(reason).toBe("expired");
  });

  it("rejects malformed tokens", async () => {
    const { valid, reason } = await verifyJwt("not-a-jwt", SECRET);
    expect(valid).toBe(false);
    expect(reason).toBe("malformed");
  });

  it("issueAccessToken sets typ=access and a 24h exp", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = await issueAccessToken("dev-1", "pro", SECRET, now);
    const { payload } = await verifyJwt(tok, SECRET);
    expect(payload?.typ).toBe("access");
    expect(payload?.tier).toBe("pro");
    expect(payload?.exp).toBe(now + 60 * 60 * 24);
  });

  it("issueRefreshToken sets typ=refresh and a 30d exp", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = await issueRefreshToken("dev-1", SECRET, now);
    const { payload } = await verifyJwt(tok, SECRET);
    expect(payload?.typ).toBe("refresh");
    expect(payload?.exp).toBe(now + 60 * 60 * 24 * 30);
  });
});
