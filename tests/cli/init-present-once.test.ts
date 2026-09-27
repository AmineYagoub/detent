import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalPath, readPresentation } from "../../src/init/present.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { commitRecord, packRepo } from "../init/pack-fixture.js";
import { APPROVE_PLAN, planning } from "../init/plan-fixture.js";
import { CUT, draft, slicing } from "../init/seed-fixture.js";
import { inputsOf } from "../init/slicing-fixture.js";

/**
 * PRDR-296 — the presentation is printed once, off a terminal as on one, and
 * what `run` replays is the text `init` printed (C-7, PRDR-255).
 *
 * `presentStage` printed it, the machine put the interrupt's message, which
 * carries it, among the run's messages, and `cli/init.ts` printed those and
 * then the interrupt: three copies of the plan an operator is asked to read.
 * These drive both entry points the operator runs, with the line reader
 * answering, and count the persisted rendering in what each wrote. The pack
 * conforms, so the sessions are planning's alone.
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
const { main: runMain } = await import("../../src/cli/run.js");

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

/** What a command wrote to stdout, taken before the spy is restored (PRDR-251). */
async function stdoutOf(body: () => Promise<unknown>): Promise<string> {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await body();
    return out.mock.calls.map((c) => String(c[0])).join("");
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

async function init(onTerminal: boolean, answers: string[]): Promise<{ readonly root: string; readonly out: string }> {
  const root = packRepo();
  commitRecord(root);
  setTty(onTerminal ? true : undefined);
  reader.answers = answers;
  const backend = new MockBackend({
    ...planning((spec) => {
      const given = inputsOf(spec);
      const out = path.basename(spec.artifactOut);
      const artifact = out === "slices.json" ? slicing(CUT, 1) : out === "plan-draft.json" ? draft(given) : APPROVE_PLAN;
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
      return okResult();
    }),
  });
  const out = await stdoutOf(async () => await initMain([root], { buildBackend: () => backend }));
  return { root, out };
}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe("PRDR-296 `detent init` prints the presentation once", () => {
  it("off a terminal, and `detent run` replays the same text, once", async () => {
    const { root, out } = await init(false, []);
    const shown = readPresentation(root)?.presentation ?? "";
    expect(shown).toMatch(/^Plan ready for approval\./u);
    expect(occurrences(out, shown), "init's stdout").toBe(1);

    setTty(undefined);
    const replayed = await stdoutOf(async () => await runMain([root, "--backend", "mock", "--no-worktree"], {}));
    expect(occurrences(replayed, shown), "run's stdout: the persisted text, byte for byte").toBe(1);
  }, 60_000);

  it("on a terminal, deferred at the prompt: shown before the question, and not again after it", async () => {
    const { root, out } = await init(true, ["l"]);
    const shown = readPresentation(root)?.presentation ?? "";
    expect(reader.asked).toEqual(["\nApprove this plan? [y]es / [n]o / [l]ater "]);
    expect(occurrences(out, shown)).toBe(1);
    expect(out.indexOf(shown), "the deferral follows the plan").toBeLessThan(out.indexOf("Approval deferred"));
  }, 60_000);

  it("on a terminal, approved at the prompt: shown once, and the approval recorded", async () => {
    const { root, out } = await init(true, ["y"]);
    expect(occurrences(out, readPresentation(root)?.presentation ?? "")).toBe(1);
    expect(existsSync(approvalPath(root))).toBe(true);
  }, 60_000);
});
