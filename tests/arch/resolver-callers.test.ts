import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { RESOLVER_CALLER_STATES } from "../../src/schemas/states.js";
import { TABLE } from "../../src/kernel/machine.js";

/**
 * T-013 / R-4 — the resolver's caller set is closed (X-2, D-13).
 *
 * Two independent assertions, because the design collapses X-2's four named
 * callers into a single call site behind the guard registry:
 *   1. source scan — exactly one call site outside the resolver's own module;
 *   2. table scan  — exactly the four states X-2 names route to that guard.
 * Together these are stronger than the source scan alone: the first proves the
 * ladder cannot be entered from anywhere else in the codebase, the second that
 * the four entries are the intended ones.
 */
const SRC = path.resolve(import.meta.dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = path.join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("X-2 closed caller set", () => {
  it("resolveRed is called from exactly one site outside its own module", () => {
    const callers = walk(SRC)
      .filter((f) => !f.endsWith(path.join("kernel", "resolver.ts")))
      .filter((f) => /\bresolveRed\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(callers).toEqual([path.join("kernel", "machine.ts")]);
  });

  it("exactly the four X-2 states route a red gate through the resolver", () => {
    const routed = [...TABLE.entries()]
      .filter(([, row]) => "guard" in row && row.guard === "resolveRed")
      .map(([k]) => k.split("|")[0]!)
      .sort();
    expect(routed).toEqual([...RESOLVER_CALLER_STATES].sort());
  });

  it("INFORMED_FIX is not among them — its red gate is a direct table edge", () => {
    const row = TABLE.get("INFORMED_FIX|GATE_RED");
    expect(row).toEqual({ to: "NEEDS_HUMAN" });
  });

  it("review verdicts never reach the resolver — REVIEW_CHANGES is a judgment", () => {
    const row = TABLE.get("IN_REVIEW|REVIEW_CHANGES");
    expect(row).toEqual({ guard: "reviewChanges" });
  });
});
