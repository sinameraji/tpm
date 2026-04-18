import { describe, it, expect } from "vitest";
import { run } from "./index.js";

describe("cli entry (M1 scaffold)", () => {
  it("run() resolves without throwing", async () => {
    await expect(run([])).resolves.toBeUndefined();
  });
});
