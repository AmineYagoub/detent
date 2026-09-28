import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { readProgressMark } from "../../src/kernel/ledger.js";
import { readLedgerRows } from "../../src/kernel/ledger-rows.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { guardToolUse } from "../../src/sessions/guard.js";
import { okResult, resultFromSdk, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { inputsOf } from "./slicing-fixture.js";
import type { Json } from "./decide-fixture.js";
import { PROMPTS, repo } from "./plan-fixture.js";
import { appliesAll, initThroughValidate, review, type Reviewers } from "./validate-fixture.js";
import { RAW } from "./write-fixture.js";
import { ALL, CODES, prdOf, wide } from "./validate-wide-fixture.js";

/**
 * PRDR-313 — VALIDATE reviews four areas at once, and keeps each review as it
 * lands (C-2²³).
 *
 * Tabachir's pack has 26 areas, and C-2¹⁴ reviewed them one after another:
 * its first reviewer ran for more than half an hour, so a round would take
 * most of a day, and the round held every review in memory until its writer
 * ran, so a stop anywhere in that day lost all of them. The fixture's pack has
 * seven areas: the foundations and six module PRDs, each its own area.
 */

/** A minor finding at the area's first requirement, so the writer's inputs show the merge's order. */
const minorAt = (file: string): Json => ({
  severity: "minor",
  category: "gap",
  places: [{ file, line: 5, quote: "Borrowing a tool MUST cost nothing in the MVP" }],
  why: `the price rule in ${file} names no currency`,
  fix: `say DZD in ${file}`,
  previous: null,
});
const findingsFor = (inputs: Json): Json[] => ((inputs["documents"] as string[] | undefined) ?? []).filter((d) => d.startsWith("docs/prd/0")).map(minorAt);

const CRASH = resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });

interface Holding extends Reviewers {
  readonly specs: SessionSpec[];
  readonly max: () => number;
}

/**
 * Reviewers held until no other has started for a moment, then let end
 * last-first, so a batch is seen whole and ends out of the order it began in.
 * The reviewer of `failing` crashes.
 */
function holding(failing: string | null = null): Holding {
  const inputs: Json[] = [];
  const specs: SessionSpec[] = [];
  const held: (() => void)[] = [];
  let inFlight = 0;
  let max = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stage: StageFn = async (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    specs.push(spec);
    inFlight += 1;
    max = Math.max(max, inFlight);
    await new Promise<void>((resolve) => {
      held.push(resolve);
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const release of held.splice(0).reverse()) release();
      }, 10);
    });
    inFlight -= 1;
    if (given["area"] === failing) return CRASH;
    writeFileSync(spec.artifactOut, `${JSON.stringify(review(given, findingsFor(given)))}\n`);
    return okResult({ turns: 4 });
  };
  return { stage, inputs, specs, max: () => max };
}

const keptFile = (root: string): string => path.join(stateDir(root), "state", "validate", "reviews-kept.json");
const areasOf = (r: Reviewers): unknown[] => r.inputs.map((i) => i["area"]);

describe("PRDR-313 VALIDATE reviews four areas at once, and merges what they found in the areas' order (C-2²³)", () => {
  it("never has more than four reviewers in flight, starts them in the areas' order, and hands the writer their findings in that order", async () => {
    const root = repo(RAW);
    const reviewers = holding();
    const writer = appliesAll();
    await initThroughValidate(root, { reviewers, writer }, wide());

    expect(reviewers.max()).toBe(4);
    expect(areasOf(reviewers)).toEqual(ALL);
    const given = (writer.inputs[0]?.["findings"] as { places: { file: string }[] }[] | undefined) ?? [];
    expect(given.map((f) => f.places[0]?.file)).toEqual(CODES.map((_, i) => prdOf(i)));
  });

  it("gives each reviewer its own artifact, and lets each write only its own", async () => {
    const root = repo(RAW);
    const reviewers = holding();
    await initThroughValidate(root, { reviewers, writer: appliesAll() }, wide());

    const outs = reviewers.specs.map((s) => path.relative(root, s.artifactOut));
    expect(new Set(outs).size).toBe(ALL.length);
    for (const spec of reviewers.specs) {
      expect(spec.policy?.surface).toEqual([path.relative(root, spec.artifactOut)]);
      for (const other of outs.filter((o) => o !== path.relative(root, spec.artifactOut))) {
        expect(guardToolUse("Write", { file_path: path.join(root, other) }, spec.policy!).decision, other).toBe("deny");
      }
    }
  });
});

describe("PRDR-313 each review is kept as it lands, so a re-run after a stop reviews only what no kept review answers (C-2²³)", () => {
  it("fails the phase for a reviewer that failed once the batch in flight has ended, keeps the reviews that ended, and a re-run reviews the rest", async () => {
    const root = repo(RAW);
    const first = holding("Area RTN");
    await expect(initThroughValidate(root, { reviewers: first, writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);
    expect(areasOf(first), "the batch in flight, and nothing after the failure").toEqual(ALL.slice(0, 4));
    expect(existsSync(keptFile(root))).toBe(true);
    const before = readLedgerRows(root).filter((r) => r.phase !== "VALIDATE").reduce((total, r) => total + r.cost_estimate_usd, 0);
    expect(readProgressMark(root).spent, "a kept review is a unit of work (X-1⁵)").toBeGreaterThan(before);

    const notes: string[] = [];
    const second = holding();
    const writer = appliesAll();
    await initThroughValidate(root, { reviewers: second, writer, notes }, wide());
    expect(areasOf(second)).toEqual(["Area RTN", ...ALL.slice(4)]);
    expect(notes.join("\n")).toMatch(/VALIDATE round 1: 3 of 7 reviews are the ones a stopped run kept/u);
    const given = (writer.inputs[0]?.["findings"] as { places: { file: string }[] }[] | undefined) ?? [];
    expect(given.map((f) => f.places[0]?.file), "the kept and the new, merged in the areas' order").toEqual(CODES.map((_, i) => prdOf(i)));
    expect(existsSync(keptFile(root)), "gone once the round is recorded").toBe(false);
  });

  it("reviews again an area whose documents moved since its review was kept", async () => {
    const root = repo(RAW);
    await expect(initThroughValidate(root, { reviewers: holding("Area RTN"), writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);
    const moved = path.join(root, prdOf(1));
    writeFileSync(moved, readFileSync(moved, "utf8").replace("# 02 — BRW", "# 02 — BRW, borrowing"));

    const second = holding();
    await initThroughValidate(root, { reviewers: second, writer: appliesAll() }, wide());
    expect(areasOf(second)).toEqual(["Area BRW", "Area RTN", ...ALL.slice(4)]);
  });

  it("reviews every area again when the reviewer's prompt is not the one its reviews were kept with", async () => {
    const root = repo(RAW);
    await expect(initThroughValidate(root, { reviewers: holding("Area RTN"), writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);

    const second = holding();
    const prompts = { ...PROMPTS, hashes: { ...PROMPTS.hashes, spec_review: "0".repeat(64) } };
    await initThroughValidate(root, { reviewers: second, writer: appliesAll(), more: { prompts } }, wide());
    expect(areasOf(second)).toEqual(ALL);
  });

  it("reviews every area again when the kept file is one this build cannot read", async () => {
    const root = repo(RAW);
    await expect(initThroughValidate(root, { reviewers: holding("Area RTN"), writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);
    const kept = JSON.parse(readFileSync(keptFile(root), "utf8")) as Json;
    writeFileSync(keptFile(root), JSON.stringify({ ...kept, schema_version: SCHEMA_VERSION + 1 }));

    const second = holding();
    await initThroughValidate(root, { reviewers: second, writer: appliesAll() }, wide());
    expect(areasOf(second)).toEqual(ALL);
  });

  it("no session can write the kept reviews: the structural floor keeps every session out of `.detent/state/` (SEC-3′)", async () => {
    const root = repo(RAW);
    const first = holding("Area RTN");
    await expect(initThroughValidate(root, { reviewers: first, writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);
    for (const spec of first.specs) expect(guardToolUse("Write", { file_path: keptFile(root) }, spec.policy!).decision).toBe("deny");
  });
});
