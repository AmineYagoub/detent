import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { detentBuild } from "../../src/kernel/build.js";
import { MIXED_BUILDS_REFUSED, approvalPath, readPresentation } from "../../src/init/present.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { commitRecord, packRepo } from "../init/pack-fixture.js";
import { APPROVE_PLAN, planning } from "../init/plan-fixture.js";
import { CUT, draft, slicing } from "../init/seed-fixture.js";
import { inputsOf } from "../init/slicing-fixture.js";

/**
 * PRDR-297 (N-5″) — `detent init` approves a plan more than one build made the
 * way `detent run` installs a toolchain (PRDR-276): on a terminal it asks
 * [y/N] after naming the builds, and off one `--approve` needs
 * `--accept-mixed-builds` beside it, or the approval is refused.
 *
 * Each case plans the conforming pack once, deferred, then marks PLAN's
 * checkpoint as an older build's, as a plan drafted before an upgrade and
 * resumed after it would be. Nothing re-runs: a build is in no key (C-8).
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

const CURRENT = detentBuild();
const FOREIGN = "3.0.9+0123456789ab";
const MIXED_QUESTION = "\nAccept that the builds above made this plan? [y/N] ";
const APPROVAL_QUESTION = "\nApprove this plan? [y]es / [n]o / [l]ater ";

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

const backend = (): MockBackend =>
  new MockBackend({
    ...planning((spec) => {
      const given = inputsOf(spec);
      const out = path.basename(spec.artifactOut);
      const artifact = out === "slices.json" ? slicing(CUT, 1) : out === "plan-draft.json" ? draft(given) : APPROVE_PLAN;
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
      return okResult();
    }),
  });

async function initOf(root: string, args: readonly string[], onTerminal: boolean, answers: string[] = []): Promise<{ readonly code: number; readonly out: string }> {
  setTty(onTerminal ? true : undefined);
  reader.answers = answers;
  reader.asked = [];
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const code = await initMain([root, ...args], { buildBackend: backend });
    return { code, out: out.mock.calls.map((c) => String(c[0])).join("") };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

/** The pack planned and deferred, then PLAN's checkpoint marked as an older build's. */
async function mixedPlan(): Promise<string> {
  const root = packRepo();
  commitRecord(root);
  expect((await initOf(root, [], false)).code).toBe(2);
  const file = path.join(stateDir(root), "state", "PLAN.json");
  writeFileSync(file, `${JSON.stringify({ ...(JSON.parse(readFileSync(file, "utf8")) as object), build: FOREIGN }, null, 2)}\n`);
  return root;
}

const approvalOf = (root: string): Record<string, unknown> => JSON.parse(readFileSync(approvalPath(root), "utf8")) as Record<string, unknown>;

describe("PRDR-297 `detent init` approves a plan more than one build made only once that is accepted", () => {
  it("off a terminal, refuses `--approve` alone, and approves with `--accept-mixed-builds` beside it", async () => {
    const root = await mixedPlan();

    const refused = await initOf(root, ["--approve", "--by", "the-operator"], false);
    expect(refused.code).toBe(2);
    expect(refused.out).toContain(MIXED_BUILDS_REFUSED);
    expect(refused.out, "the builds are named in what it refused").toContain(`  ${FOREIGN}  PLAN`);
    expect(existsSync(approvalPath(root))).toBe(false);
    expect(readPresentation(root)?.builds).toEqual([CURRENT, FOREIGN]);

    const approved = await initOf(root, ["--approve", "--accept-mixed-builds", "--by", "the-operator"], false);
    expect(approved.code).toBe(0);
    expect(approvalOf(root)).toMatchObject({ approved_by: "the-operator", builds: [CURRENT, FOREIGN] });
  }, 60_000);

  it("on a terminal, asks [y/N] after naming the builds, and only a yes puts the approval question", async () => {
    const root = await mixedPlan();

    const enter = await initOf(root, [], true, [""]);
    expect(reader.asked, "an empty answer is a no").toEqual([MIXED_QUESTION]);
    expect(enter.code).toBe(2);

    const no = await initOf(root, [], true, ["n"]);
    expect(reader.asked).toEqual([MIXED_QUESTION]);
    expect(no.code).toBe(2);
    expect(no.out.indexOf(`  ${FOREIGN}  PLAN`), "named before it is asked").toBeGreaterThan(-1);
    expect(existsSync(approvalPath(root))).toBe(false);

    const yes = await initOf(root, [], true, ["y", "y"]);
    expect(reader.asked).toEqual([MIXED_QUESTION, APPROVAL_QUESTION]);
    expect(yes.code).toBe(0);
    expect(approvalOf(root)["builds"]).toEqual([CURRENT, FOREIGN]);
  }, 60_000);

  it("takes a relayed decline as a decline: it approves nothing, so it needs no acceptance", async () => {
    const root = await mixedPlan();
    const declined = await initOf(root, ["--decline"], false);
    expect(declined.code).toBe(2);
    expect(declined.out).toContain("Approval declined");
    expect(declined.out).not.toContain(MIXED_BUILDS_REFUSED);
  }, 60_000);

  it("asks nothing more of a plan one build made (the control)", async () => {
    const root = packRepo();
    commitRecord(root);
    const approved = await initOf(root, [], true, ["y"]);
    expect(reader.asked).toEqual([APPROVAL_QUESTION]);
    expect(approved.code).toBe(0);
    expect(approvalOf(root)["builds"]).toEqual([CURRENT]);
  }, 60_000);
});
