import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { appendToDecisionLog, decisionLogFile, nextId, readDecisionLog, type LogAdditions } from "../../src/init/decide-log.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-282 — the decision log, read and extended in the pack's grammar
 * (C-2⁷, C-2¹²). DECIDE appends; it never rewrites a row the founder wrote.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(files: Record<string, string> = {}): string {
  const dir = tmpTree({ "PRD.md": "# spec\n", ...files });
  roots.push(dir);
  return dir;
}

const NONE: LogAdditions = { decisions: [], defaults: [], stack: null };
const read = (dir: string): string => readFileSync(decisionLogFile(dir), "utf8");
/** What the grammar refuses in the log itself; a log alone is not a pack, so the layout's findings are not the log's. */
const problems = (dir: string) => parsePack(dir, [DECISION_LOG_PATH], { greenfield: false }).problems.filter((p) => p.file === DECISION_LOG_PATH);

const FOUNDER = [
  "# Founder decisions",
  "",
  "## Decisions",
  "",
  "| Id | Question | Answer | Reason |",
  "|---|---|---|---|",
  "| D-1 | Who may borrow? | **Members only** | Tools are expensive. |",
  "| D-7 | How long is a loan? | **Seven days** | A weekend job. |",
  "",
  "```",
  "## Defaults",
  "| X-99 | inside a fence | never read |",
  "```",
  "",
  "## Defaults",
  "",
  "| Id | Default | Reason |",
  "|---|---|---|",
  "| X-2 | Amounts are integers in minor units. | No rounding drift. |",
  "",
  "## Notes",
  "",
  "Free text the founder keeps.",
  "",
].join("\n");

describe("PRDR-282: DECIDE writes the decision log in the pack's grammar", () => {
  it("creates the log, and the pack's parser reads back every row it wrote, a bar and a line break included", () => {
    const dir = root();
    appendToDecisionLog(dir, readDecisionLog(dir), {
      decisions: [{ id: "D-1", question: "Is a deposit | a hold taken?", answer: "A hold", reason: "Refunds cost the fee." }],
      defaults: [{ id: "X-1", value: "Reminders go out\ntwo days before a due date.", reason: "Set in the PRD." }],
      stack: null,
    });
    expect(problems(dir)).toEqual([]);
    const log = readDecisionLog(dir);
    expect(log.decisions).toEqual([{ id: "D-1", question: "Is a deposit | a hold taken?", answer: "**A hold**", reason: "Refunds cost the fee." }]);
    expect(log.defaults).toEqual([{ id: "X-1", value: "Reminders go out two days before a due date.", reason: "Set in the PRD." }]);
    expect(read(dir)).toContain("### Asked at DECIDE");
    expect(read(dir)).toContain("### Settled at DECIDE");
  });

  it("appends under a heading of its own and leaves every line the founder wrote where it was", () => {
    const dir = root({ [DECISION_LOG_PATH]: FOUNDER });
    appendToDecisionLog(dir, readDecisionLog(dir), {
      decisions: [{ id: "D-8", question: "Is there a late fee?", answer: "Two dollars a day", reason: "Late returns block the queue." }],
      defaults: [{ id: "X-3", value: "A reservation lapses after a day.", reason: "The PRD's queue rule." }],
      stack: null,
    });
    const after = read(dir).split("\n");
    const founder = FOUNDER.split("\n");
    /* Every founder line survives in order: the additions only interleave. */
    let at = 0;
    for (const line of after) if (line === founder[at]) at += 1;
    expect(at, "every line the founder wrote is still there, in order").toBe(founder.length);
    expect(problems(dir)).toEqual([]);
    const log = readDecisionLog(dir);
    expect(log.decisions.map((d) => d.id)).toEqual(["D-1", "D-7", "D-8"]);
    expect(log.defaults.map((d) => d.id)).toEqual(["X-2", "X-3"]);
    expect(read(dir).indexOf("### Asked at DECIDE"), "inside ## Decisions, before ## Defaults").toBeLessThan(read(dir).indexOf("## Defaults\n\n|"));
    expect(read(dir).indexOf("### Settled at DECIDE")).toBeLessThan(read(dir).indexOf("## Notes"));
  });

  it("puts a later run's rows after its earlier ones, under the same heading", () => {
    const dir = root({ [DECISION_LOG_PATH]: FOUNDER });
    appendToDecisionLog(dir, readDecisionLog(dir), { ...NONE, defaults: [{ id: "X-3", value: "first", reason: "r" }] });
    appendToDecisionLog(dir, readDecisionLog(dir), { ...NONE, defaults: [{ id: "X-4", value: "second", reason: "r" }] });
    expect(read(dir).match(/### Settled at DECIDE/gu)).toHaveLength(1);
    expect(readDecisionLog(dir).defaults.map((d) => d.id)).toEqual(["X-2", "X-3", "X-4"]);
    expect(problems(dir)).toEqual([]);
  });

  it("keeps a log's CRLF line endings", () => {
    const dir = root({ [DECISION_LOG_PATH]: FOUNDER.replaceAll("\n", "\r\n") });
    appendToDecisionLog(dir, readDecisionLog(dir), { ...NONE, defaults: [{ id: "X-3", value: "v", reason: "r" }] });
    expect(read(dir).replaceAll("\r\n", "")).not.toContain("\n");
    expect(readDecisionLog(dir).defaults.map((d) => d.id)).toEqual(["X-2", "X-3"]);
  });

  it("writes nothing, and creates no file, when there is nothing to add", () => {
    const dir = root();
    appendToDecisionLog(dir, readDecisionLog(dir), NONE);
    expect(readDecisionLog(dir).exists).toBe(false);
  });

  it("numbers after the highest id the log holds, and ignores an id in another shape", () => {
    const dir = root({ [DECISION_LOG_PATH]: FOUNDER.replace("| D-1 |", "| D1 |") });
    const log = readDecisionLog(dir);
    expect([...log.ids].sort()).toEqual(["D-7", "D1", "X-2"]);
    expect([nextId(log.ids, "D")(0), nextId(log.ids, "D")(1), nextId(log.ids, "X")(0)]).toEqual(["D-8", "D-9", "X-3"]);
  });
});

describe("PRDR-282: DECIDE records the stack as a structured entry (D-10′)", () => {
  const STACK = { decision: "X-1", language: "TypeScript", toolchain: "Node.js 24 with pnpm 10", scaffold_files: ["package.json", "tsconfig.json"], gates: { test: "pnpm test", test_single: "pnpm vitest run" } };

  it("writes `## Stack` and the root package's gates, and the pack's parser reads the same entry back", () => {
    const dir = root();
    appendToDecisionLog(dir, readDecisionLog(dir), { decisions: [], defaults: [{ id: "X-1", value: "TypeScript on Node.js 24", reason: "the documents' tooling" }], stack: STACK });
    expect(problems(dir)).toEqual([]);
    const log = readDecisionLog(dir);
    expect(log.hasStack).toBe(true);
    expect(log.stack).toEqual(STACK);
  });

  it("never writes a second stack, and adds only the gates the root package does not declare", () => {
    const withStack = [
      FOUNDER,
      "## Stack",
      "",
      "| Field | Value |",
      "|---|---|",
      "| decision | X-2 |",
      "| language | Go |",
      "| toolchain | Go 1.24 |",
      "",
      "## Packages",
      "",
      "| Package | Slot | Command |",
      "|---|---|---|",
      "| . | test | `go test ./...` |",
      "",
    ].join("\n");
    const dir = root({ [DECISION_LOG_PATH]: withStack });
    const before = read(dir);
    appendToDecisionLog(dir, readDecisionLog(dir), { ...NONE, stack: STACK });
    expect(read(dir), "a log with a stack keeps it; the founder's entry is the stack").toBe(before);
    expect(readDecisionLog(dir).stack?.language).toBe("Go");
  });

  it("adds the gates a log without a stack does not declare for the root package", () => {
    const packages = [FOUNDER, "## Packages", "", "| Package | Slot | Command |", "|---|---|---|", "| . | test | `make test` |", ""].join("\n");
    const dir = root({ [DECISION_LOG_PATH]: packages });
    appendToDecisionLog(dir, readDecisionLog(dir), { decisions: [], defaults: [{ id: "X-3", value: "TypeScript", reason: "r" }], stack: { ...STACK, decision: "X-3" } });
    expect(problems(dir)).toEqual([]);
    expect(readDecisionLog(dir).stack?.gates).toEqual({ test: "make test", test_single: "pnpm vitest run" });
  });
});
