import { describe, expect, it } from "vitest";
import { classify, errorSignature } from "../../src/kernel/classify.js";

describe("T-016 classification and signatures (X-5, X-7, D-14)", () => {
  it("classifies flake patterns as suspected, never as a verdict", () => {
    const r = classify("Error: connect ETIMEDOUT 10.0.0.1:5432", 1);
    expect(r.suspectedFlake).toBe(true);
    expect(r.patternClass).toBe("flake-pattern");
    /** D-14: there is no field a caller could read as "non-actionable". */
    expect(Object.keys(r).sort()).toEqual(["patternClass", "signature", "suspectedFlake"]);
  });

  it("a timeout (null exit) is environmental until a rerun proves otherwise", () => {
    expect(classify("no output", null).suspectedFlake).toBe(true);
  });

  it("toolchain and assertion failures are never suspected flakes", () => {
    expect(classify("src/a.ts(3,1): error TS2345: bad", 2).patternClass).toBe("toolchain");
    expect(classify("src/a.ts(3,1): error TS2345: bad", 2).suspectedFlake).toBe(false);
    expect(classify("AssertionError: expected 1 to be 2", 1).patternClass).toBe("assertion");
    expect(classify("AssertionError: expected 1 to be 2", 1).suspectedFlake).toBe(false);
  });

  it("signatures are stable across volatile details (X-7)", () => {
    const a = `FAILED tests/t.py::test_x
  File "/src/app.py", line 42, in run
AssertionError: expected 1 to equal 2
  at 0x7f8a1c2d3e00 pid=48213`;
    const b = `FAILED tests/t.py::test_x
  File "/src/app.py", line 91, in run
AssertionError: expected 1 to equal 2
  at 0x55d3ffaa1100 pid=91772`;
    expect(errorSignature(a)).toBe(errorSignature(b));
  });

  it("signatures differ across distinct failures", () => {
    const a = `FAILED tests/t.py::test_x\nAssertionError: expected 1 to equal 2`;
    const b = `FAILED tests/t.py::test_y\nAssertionError: expected 3 to equal 4`;
    expect(errorSignature(a)).not.toBe(errorSignature(b));
  });

  it("signatures are sha256 hex and deterministic", () => {
    const out = "FAILED tests/t.py::test_x\nTypeError: nope";
    expect(errorSignature(out)).toMatch(/^[0-9a-f]{64}$/);
    expect(errorSignature(out)).toBe(errorSignature(out));
  });

  it("a real regression whose output matches a flake pattern is still only *suspected* (D-14)", () => {
    /** Adversarial: the message contains "timed out" but is a genuine assertion. */
    const r = classify("AssertionError: request timed out after retry budget exhausted", 1);
    expect(r.suspectedFlake).toBe(true);
    /**
     * The classifier cannot absolve it — quarantine needs a green rerun (T-022),
     * which this module deliberately provides no way to express.
     */
    expect(r).not.toHaveProperty("nonActionable");
    expect(r).not.toHaveProperty("quarantine");
  });
});
