import { describe, expect, it } from "vitest";
import { symbolsFlagFor } from "../../scripts/self-build.js";

/** PRDR-208: the permanent gate carries the tooling the runner has, and says which. */
describe("S-3⁗ the self-build harness decides symbols from the runner's probe", () => {
  it("ready → --symbols; anything else → --no-symbols", () => {
    expect(symbolsFlagFor({ kind: "ready", command: "serena" })).toBe("--symbols");
    expect(symbolsFlagFor({ kind: "missing", command: "serena", reason: "ENOENT" })).toBe("--no-symbols");
    expect(symbolsFlagFor({ kind: "off" })).toBe("--no-symbols");
  });
});
