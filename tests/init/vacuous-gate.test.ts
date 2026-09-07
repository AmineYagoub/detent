import { afterEach, describe, expect, it } from "vitest";
import { buildPipeline } from "../../src/init/pipeline.js";
import { vacuousGateNotices } from "../../src/adapter/bind.js";
import { scrub } from "../../src/kernel/scrub.js";
import type { Candidate } from "../../src/adapter/discover/types.js";
import type { GateResult } from "../../src/adapter/run.js";
import type { Binding } from "../../src/schemas/records.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import type { Budgets } from "../../src/schemas/budgets.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * V-1‴ (PRDR-156) — the notice, where the operator actually stands.
 *
 * `19d68f7` shipped this feature complete and unreachable: `determineVerification`
 * emitted through `deps.note?.()`, and `determinePhase` was the one handler in
 * `pipeline.ts` that did not forward `note`. Its test asserted on `report.notices`
 * at the ADAPTER layer — one level below the hop that dropped it — so it was green
 * on a feature no operator could ever see. These assert on what the CLI's own
 * callback receives, through the real `buildPipeline`.
 */

const PROMPTS = loadPromptSet();
const BUDGETS = Object.fromEntries(
  Object.entries(CEILINGS).map(([k, spec]) => [k, "default" in spec ? (spec as { default: number }).default : 25]),
) as Budgets;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A brownfield repo whose one gate is `echo` — the case V-1‴ is named for. */
function repoWithVacuousTest(script: string): string {
  const root = tmpTree({
    "package.json": `${JSON.stringify({ name: "vacuous", version: "1.0.0", scripts: { test: script } }, null, 2)}\n`,
  });
  roots.push(root);
  gitInit(root);
  return root;
}

/** Run the real DETERMINE_VERIFICATION handler and collect what the operator was told. */
async function noticesShownTo(root: string): Promise<string[]> {
  const shown: string[] = [];
  const handlers = buildPipeline({
    root,
    backend: new MockBackend(),
    prompts: PROMPTS,
    budgets: BUDGETS,
    note: (text) => shown.push(text),
  });
  const determine = handlers.find((h) => h.phase === "DETERMINE_VERIFICATION");
  if (determine === undefined) throw new Error("no DETERMINE_VERIFICATION handler");
  await determine.run({ root, outputs: {}, now: () => 0 });
  return shown;
}

describe("V-1‴ the vacuous-gate notice reaches the operator", () => {
  it("tells the operator through the pipeline's own note seam, not just the adapter's report", async () => {
    const shown = await noticesShownTo(repoWithVacuousTest("echo 'no tests here'"));
    expect(shown.join("\n"), "the operator must be told a bound gate may verify nothing").toContain("verifies nothing");
    expect(shown.join("\n")).toContain("test");
  }, 20_000);

  /**
   * PRDR-156: the redactor is injected (N-1 keeps `scrub` out of the adapter),
   * and `bindAll`'s default is identity — so proving `vacuousGateNotices` can
   * scrub proves nothing about whether production asks it to. This asserts on
   * what actually reaches the operator.
   */
  it("scrubs a secret the gate echoed, on the path the operator actually sees", async () => {
    const shown = await noticesShownTo(repoWithVacuousTest("echo token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    expect(shown.join("\n"), "the notice must be delivered at all").toContain("exits 0 having done nothing");
    expect(shown.join("\n"), "a secret echoed by the gate must not reach the operator or the checkpoint").not.toContain(
      "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  }, 20_000);

  it("says nothing about a gate that does real work", async () => {
    const shown = await noticesShownTo(repoWithVacuousTest("node -e \"if (1 + 1 !== 2) process.exit(1)\""));
    expect(shown, "a real command must not be accused").toEqual([]);
  }, 20_000);
});

/* ------------------------------------------------------------------------- */

const CAND: Candidate = {
  slot: "test",
  adapter: "node",
  ref: "test",
  resolved: "npm run test",
  pm: "npm",
  config_file: "package.json",
  config_region: "scripts.test=echo no tests here",
  config_hash: "0".repeat(64),
  rank: 0,
};

const BINDING: Binding = {
  schema_version: 1,
  slot: "test",
  adapter: "node",
  ref: "test",
  resolved: "npm run test",
  pm: "npm",
  config_hash: "0".repeat(64),
  executed_at: "2026-09-07T00:00:00.000Z",
  approved_by: "auto",
  status: "approved",
};

function bound(region: string, durationMs: number, output = ""): Parameters<typeof vacuousGateNotices>[0][number] {
  const result: GateResult = {
    slot: "test",
    command: "npm run test",
    cwd: "/tmp",
    outcome: "exited",
    green: true,
    exitCode: 0,
    signal: null,
    normalizedExit: 0,
    output,
    outputBytes: output.length,
    truncated: false,
    durationMs,
  };
  return { kind: "bound", slot: "test", binding: BINDING, candidate: { ...CAND, config_region: region }, result };
}

/**
 * The signal is the COMMAND TEXT, not its duration (PRDR-156).
 *
 * Duration was tried first and does not discriminate: the populations overlap
 * — a no-op `make` is 12 ms and legitimate, an `echo` through npm is 96 ms and
 * is not — and the 500 ms cut flagged all four gates of an ordinary project,
 * including the 344 ms script this rule's own evidence calls real work.
 */
describe("V-1‴ what counts as verifying nothing", () => {
  it("flags a command whose every statement is a no-op, however long it took", () => {
    for (const region of [
      "scripts.test=echo no tests here",
      "scripts.test=echo 'no tests' && echo done",
      "scripts.test=true",
      "scripts.test=:",
      "scripts.test=exit 0",
      "scripts.test=",
      "test:\n\t@echo \"TODO\"",
    ]) {
      /* 9000 ms: slow and still vacuous. Duration is not the signal. */
      expect(vacuousGateNotices([bound(region, 9000)], scrub), region).toHaveLength(1);
    }
  });

  it("says nothing about a real command, however fast it ran", () => {
    for (const region of [
      "scripts.test=vitest run",
      "scripts.build=tsc --noEmit",
      "exists:go.mod",
      "test:\n\tgo test ./...",
      "scripts.test=echo running && vitest run",
      "scripts.lint=eslint .",
    ]) {
      /* 3 ms: instant and legitimate — a warm no-op `make` measures 12 ms. */
      expect(vacuousGateNotices([bound(region, 3)], scrub), region).toEqual([]);
    }
  });

  /** SEC-4: the same rule `referee-gate.ts` applies to gate output it writes. */
  it("scrubs the command output it quotes back", () => {
    const notices = vacuousGateNotices([bound("scripts.test=echo hi", 40, "deploying with token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nok")], scrub);
    expect(notices).toHaveLength(1);
    expect(notices[0], "a secret echoed by the gate must not survive into the notice").not.toContain("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(notices[0]).toContain("REDACTED");
  });
});
