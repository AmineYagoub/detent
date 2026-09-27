import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { LONE_CANDIDATE, repo, planning } from "../init/plan-fixture.js";
import { DOCS, SORTED, auditFinds, decide } from "../init/decide-fixture.js";
import { TWO_SLICES, scriptedPlanner, twoSliceDraft } from "../init/slicing-fixture.js";

/**
 * PRDR-282 — on a terminal, `detent init` asks DECIDE's questions itself.
 *
 * The pipeline tests hand DECIDE an asker, which stands in for this wiring and
 * so cannot test it: whether a terminal gets `makeTtyDecisions`, and whether
 * anywhere else takes the recommended answers, is decided by the one TTY
 * expression in `cli/init.ts`. Here the streams claim a terminal or do not,
 * and the line reader answers, so the asker is the production one.
 */

const reader: { answers: string[]; asked: string[] } = { answers: [], asked: [] };

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: async (prompt: string): Promise<string> => {
      reader.asked.push(prompt);
      return reader.answers.shift() ?? "l";
    },
    close: (): void => undefined,
  }),
}));

const { main: initMain } = await import("../../src/cli/init.js");

const tty = { stdout: process.stdout.isTTY, stdin: process.stdin.isTTY };
const setTty = (on: boolean | undefined): void => {
  Object.defineProperty(process.stdout, "isTTY", { value: on, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: on, configurable: true });
};
beforeEach(() => {
  reader.asked = [];
  vi.stubEnv("DETENT_NO_LIVE", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-fixture");
});
afterEach(() => {
  setTty(tty.stdout);
  vi.unstubAllEnvs();
});

async function init(onTerminal: boolean, answers: string[]): Promise<string> {
  const root = repo({ ...LONE_CANDIDATE, ...DOCS, "prd-billing.md": "# Billing\n" });
  setTty(onTerminal ? true : undefined);
  reader.answers = answers;
  const backend = new MockBackend({
    audit: auditFinds(),
    spec_write: decide((_, i) => SORTED(i)).stage,
    ...planning(scriptedPlanner({ slices: TWO_SLICES, draft: twoSliceDraft, review: () => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] }) }, [])),
  });
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await initMain([root], { buildBackend: () => backend });
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return root;
}

describe("PRDR-282 a terminal is asked DECIDE's questions, by the asker that reads a line", () => {
  it("records the founder's answer as a decision", async () => {
    /* DECIDE's one question, then PRESENT's approval, deferred. */
    const root = await init(true, ["2", "l"]);
    expect(reader.asked[0]).toBe("\n1: [1-2], your own answer, or [l]ater ");
    expect(readDecisionLog(root).decisions.map((d) => [d.id, d.answer])).toEqual([["D-1", "**Two dollars a day**"]]);
  }, 60_000);

  it("asks nothing off a terminal, and takes the recommended answer as a default", async () => {
    const root = await init(false, []);
    expect(reader.asked).toEqual([]);
    const log = readDecisionLog(root);
    expect(log.decisions).toEqual([]);
    expect(log.defaults.map((d) => d.value)).toContain("Free in the MVP");
  }, 60_000);
});
