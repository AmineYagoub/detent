import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENTS } from "../../src/schemas/states.js";
import * as events from "../../src/kernel/events.js";

/**
 * T-054 — ARCH-1's apply-site audit: every `machine.apply` call site's event
 * derives from a validator result or a gate result.
 *
 * Two halves. Type-level: the commit path accepts only `KernelEvent`, whose
 * brand symbol is constructed in exactly one module and each constructor
 * demands its justifying artifact. Source-scan: `machine.apply` is importable
 * only where sanctioned, and the run loop contains no raw event-name string —
 * so there is no path from model output to a transition that does not pass
 * through a validator- or gate-typed constructor.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkTs(abs));
    else if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

describe("T-054 the sanctioned apply-site set (source scan)", () => {
  it("machine.apply is importable from exactly the sanctioned modules", () => {
    const importers: string[] = [];
    for (const file of walkTs(SRC)) {
      const body = readFileSync(file, "utf8");
      if (/from\s+"[^"]*\/machine\.js"|from\s+"\.\/machine\.js"/.test(body)) importers.push(rel(file));
    }
    // run.ts commits state; worstcase.ts walks table COPIES (a computation,
    // not a state mutation); plumbing.ts commits the two HUMAN_* events on an
    // operator's explicit authority (C-12) through the same journaled path.
    // Nothing else may touch the table.
    expect(importers.sort()).toEqual(["kernel/plumbing.ts", "kernel/run.ts", "kernel/worstcase.ts"]);
  });

  it("the commit paths contain no raw event-name string — events arrive only through constructors", () => {
    for (const file of ["kernel/run.ts", "kernel/plumbing.ts"]) {
      const body = readFileSync(path.join(SRC, file), "utf8");
      for (const event of EVENTS) {
        expect(body.includes(`"${event}"`), `${file} must not name ${event} as a string`).toBe(false);
      }
      // And apply() appears exactly once per file — inside its commit path.
      expect(body.match(/\bapply\(/g) ?? [], file).toHaveLength(1);
    }
  });

  it("the brand symbol is constructed in exactly one module", () => {
    const constructors: string[] = [];
    for (const file of walkTs(SRC)) {
      if (readFileSync(file, "utf8").includes('Symbol("detent.kernel.event")')) constructors.push(rel(file));
    }
    expect(constructors).toEqual(["kernel/events.ts"]);
  });

  it("stage modules commit nothing themselves — they return events for the loop's single commit path", () => {
    for (const file of walkTs(path.join(SRC, "kernel/stages"))) {
      const body = readFileSync(file, "utf8");
      expect(body, rel(file)).not.toMatch(/from\s+"[^"]*machine\.js"/);
      expect(body, rel(file)).not.toMatch(/\bapply\(/);
    }
  });
});

describe("T-054 constructors demand their justifying artifacts (type level, spot-checked at runtime)", () => {
  it("gate events carry gate evidence; validator events carry parsed artifacts", () => {
    const gateResult = {
      slot: "test" as const,
      command: "x",
      cwd: "/",
      outcome: "exited" as const,
      green: false,
      exitCode: 1,
      signal: null,
      normalizedExit: 1,
      output: "",
      outputBytes: 0,
      truncated: false,
      durationMs: 1,
    };
    expect(events.gateRed(gateResult).event).toBe("GATE_RED");
    expect(events.gateGreen(gateResult).evidence).toContain("exit=1");
    expect(events.gateGreen(null).evidence).toBe("no bound gates");
    expect(events.reproAsPredicted(gateResult).evidence).toContain("as-predicted");

    const review = { schema_version: 1 as const, verdict: "changes" as const, changes: [{ tag: "scope" as const, finding: "x" }] };
    expect(events.reviewChanges(review).evidence).toContain("1 findings");

    // The constructor set covers every event the loop can emit; the two
    // human-side events (HUMAN_APPROVED via plumbing) arrive at T-055.
    const constructed = new Set(
      [
        events.claimed(),
        events.humanRequeue("consent"),
        events.gateGreen(null),
        events.gateRed(gateResult),
        events.reproAsPredicted(gateResult),
        events.reproWrong({ invalidArtifact: "x" }),
        events.premiseFalsified("note"),
        events.reviewApprove({ schema_version: 1, verdict: "approve", changes: [] }),
        events.reviewChanges(review),
        events.researchDry("dry"),
        events.budgetBreach("reason"),
        events.riskRequired("label"),
      ].map((e) => e.event),
    );
    expect(constructed.size).toBeGreaterThanOrEqual(11);
  });
});
