import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { acknowledgeSkip, bindAll, bindSlot, resolveChoice } from "../../src/adapter/bind.js";
import { discover, gatherFacts, type Candidate } from "../../src/adapter/discover/index.js";
import { DriftHaltError, assertNoDrift, readBindings, writeBindings } from "../../src/adapter/drift.js";
import { NO_LOCKFILE, fingerprint } from "../../src/adapter/env.js";
import { CI_ENV } from "../../src/adapter/normalize.js";
import { runGate, runnable, type GateSlot } from "../../src/adapter/run.js";
import { detectWorkspace } from "../../src/adapter/workspace.js";
import { EXIT_NOT_READY, EXIT_OK, verifySync } from "../../src/cli/verify.js";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import type { Binding } from "../../src/schemas/records.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";

/**
 * T-030 — the M1 exit: the full adapter flow, discover → execute → approve →
 * drift, on three real ecosystems (N-1), through one driver with zero
 * per-ecosystem branches. The differences between fixtures live in data — the
 * expectations table below — which is the "bindings-only diffs" the AC asks
 * for, and the cross-fixture assertions at the bottom check it on the actual
 * `.detent/` trees.
 *
 * Gates execute for real: node and python via the host, go via the toolchain.
 * A host without go skips the go leg loudly; in CI a missing toolchain is a
 * FAILURE, never a skip — an exit gate that can silently skip is not a gate.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const SRC = fileURLToPath(new URL("../../src", import.meta.url));

const goAvailable = ((): boolean => {
  try {
    execFileSync("go", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();
if (process.env.CI !== undefined && !goAvailable) {
  throw new Error("the M1 exit e2e requires the go toolchain on CI hosts; the runner image must provide it");
}
const itGo = goAvailable ? it : it.skip;
if (!goAvailable) console.warn("[T-030] go toolchain absent — the go-cli leg is skipped HERE and arbitrated in CI.");

const PROBE_TIMEOUT_MS = 120_000;

interface FixturePlan {
  readonly fixture: string;
  /** T-021 expectations. */
  readonly ecosystem: string;
  readonly lockfile: string;
  /** slot → [adapter, resolved] once approved. */
  readonly bound: Readonly<Partial<Record<GateSlot, readonly [string, string]>>>;
  /** V-1 ambiguity: resolve this slot to this adapter, as user "dev". */
  readonly choose?: { readonly slot: GateSlot; readonly adapter: string };
  readonly skips: readonly GateSlot[];
  /** V-3: edit the defining region of this slot's binding. */
  readonly drift: { readonly slot: GateSlot; readonly edit: (root: string) => void };
}

const PLANS: readonly FixturePlan[] = [
  {
    fixture: "ts-service",
    ecosystem: "node",
    lockfile: "package-lock.json",
    bound: { test: ["node-scripts", "npm run test"], lint: ["node-scripts", "npm run lint"] },
    skips: ["test_single", "typecheck", "build", "e2e"],
    drift: {
      slot: "test",
      edit: (root) => {
        const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
          scripts: Record<string, string>;
        };
        manifest.scripts["test"] = "node --test test/";
        writeTree(root, { "package.json": `${JSON.stringify(manifest, null, 2)}\n` });
      },
    },
  },
  {
    fixture: "py-service",
    ecosystem: "python",
    lockfile: "uv.lock",
    bound: { test: ["make", "make test"], lint: ["make", "make lint"] },
    skips: ["test_single", "typecheck", "build", "e2e"],
    drift: {
      slot: "test",
      edit: (root) => {
        const makefile = readFileSync(path.join(root, "Makefile"), "utf8");
        writeTree(root, {
          Makefile: makefile.replace(
            "python3 -m unittest discover -s tests",
            'python3 -m unittest discover -s tests -p "test_*.py"',
          ),
        });
      },
    },
  },
  {
    fixture: "go-cli",
    ecosystem: "go",
    /* no go.sum: a zero-dependency module (R-7 fallback) */
    lockfile: NO_LOCKFILE,
    bound: { test: ["make", "make test"], lint: ["go", "go vet ./..."], build: ["go", "go build ./..."] },
    choose: { slot: "test", adapter: "make" },
    skips: ["test_single", "typecheck", "e2e"],
    drift: {
      slot: "test",
      edit: (root) => {
        const makefile = readFileSync(path.join(root, "Makefile"), "utf8");
        writeTree(root, { Makefile: makefile.replace("go test ./...", "go test -count=1 ./...") });
      },
    },
  },
];

interface E2EResult {
  readonly root: string;
  readonly detentFiles: readonly string[];
  readonly gitignore: string;
  readonly bindingsJson: string;
}

const results = new Map<string, E2EResult>();
const roots: string[] = [];
afterAll(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** The one driver. No per-ecosystem branches: everything varies via `plan`. */
async function runE2E(plan: FixturePlan): Promise<E2EResult> {
  const root = tmpTree();
  roots.push(root);
  cpSync(path.join(FIXTURES, plan.fixture), root, { recursive: true });
  initLayout(root);

  /** --- discover ------------------------------------------------------------- */
  const fp = await fingerprint(root, { probeRuntimes: false });
  expect(fp.ecosystems.map((e) => e.ecosystem)).toEqual([plan.ecosystem]);
  expect(fp.ecosystems[0]?.lockfile).toBe(plan.lockfile);
  expect(detectWorkspace(gatherFacts(root))).toBeNull();

  /** --- execute + approve (V-1: every candidate runs before approval) -------- */
  const report = await bindAll(discover(root), { root, timeoutMs: PROBE_TIMEOUT_MS });
  const bindings: Binding[] = [...report.bindings];

  if (plan.choose === undefined) {
    expect(report.interrupts).toEqual([]);
  } else {
    expect(report.interrupts.map((i) => i.kind)).toEqual(["choice-required"]);
    const choice = report.interrupts[0]!;
    if (choice.kind !== "choice-required") throw new Error("unreachable");
    expect(choice.slot).toBe(plan.choose.slot);
    const chosen = choice.candidates.find((c) => c.adapter === plan.choose?.adapter) as Candidate;
    const resolved = await resolveChoice(choice, chosen, "dev", { root, timeoutMs: PROBE_TIMEOUT_MS });
    expect(resolved.kind).toBe("bound");
    if (resolved.kind !== "bound") throw new Error("unreachable");
    expect(resolved.binding.approved_by).toBe("dev");
    bindings.push(resolved.binding);
  }

  const expected = Object.entries(plan.bound) as [GateSlot, readonly [string, string]][];
  expect(bindings).toHaveLength(expected.length);
  for (const [slot, [adapter, resolved]] of expected) {
    const binding = bindings.find((b) => b.slot === slot);
    expect(binding, slot).toMatchObject({ adapter, resolved, status: "approved" });
    /** C-3b provenance: auto everywhere a human did not choose. */
    expect(binding?.approved_by).toBe(plan.choose?.slot === slot ? "dev" : "auto");
  }
  expect([...report.unbound].sort()).toEqual([...plan.skips].sort());

  writeBindings(root, { bindings, skips: plan.skips.map((slot) => acknowledgeSkip(slot, "dev")) });
  expect(readBindings(root).bindings).toEqual(bindings);
  expect(assertNoDrift(readBindings(root).bindings, discover(root)).halting).toEqual([]);

  /** --- the run loop's path: every approved binding executes green as stored - */
  for (const binding of bindings) {
    const rerun = await runGate({
      command: binding.resolved,
      cwd: root,
      slot: binding.slot,
      timeoutMs: PROBE_TIMEOUT_MS,
      env: CI_ENV,
    });
    expect(runnable(rerun), `${binding.slot}: ${binding.resolved}`).toBe(true);
    expect(rerun.green, `${binding.slot}: ${binding.resolved}\n${rerun.output}`).toBe(true);
  }

  /* --- drift (V-3): edit the defining region, halt, re-baseline ------------- */
  plan.drift.edit(root);
  const before = readBindings(root).bindings;
  let halted: DriftHaltError | null = null;
  try {
    assertNoDrift(before, discover(root));
  } catch (err) {
    halted = err as DriftHaltError;
  }
  expect(halted).toBeInstanceOf(DriftHaltError);
  expect(halted?.exitCode).toBe(2);
  expect(halted?.halting.map((h) => h.slot)).toEqual([plan.drift.slot]);
  expect(halted?.message).toContain(before.find((b) => b.slot === plan.drift.slot)?.config_hash);

  if (plan.choose === undefined) {
    /** `verify sync` re-runs V-1 — including execution — and re-baselines. */
    const declined = await verifySync(root, { consent: async () => false });
    expect(declined.exitCode).toBe(EXIT_NOT_READY);
    expect(readBindings(root).bindings).toEqual(before);

    const accepted = await verifySync(root, { consent: async () => true });
    expect(accepted.exitCode).toBe(EXIT_OK);
    expect(accepted.summary.drift.filter((d) => d.status === "drifted").map((d) => d.slot)).toEqual([plan.drift.slot]);
  } else {
    /**
     * The ambiguous slot stays ambiguous, so sync refuses to guess (V-1) —
     * asserted, because refusing is the correct behaviour, not a limitation.
     */
    let consulted = false;
    const refused = await verifySync(root, {
      consent: async () => {
        consulted = true;
        return true;
      },
    });
    expect(refused.exitCode).toBe(EXIT_NOT_READY);
    expect(consulted).toBe(false);
    expect(refused.messages.join(" ")).toContain("plausible candidates");

    /** The human resolves it, exactly as at init; unchanged bindings survive. */
    const choice = await bindSlot(plan.choose.slot, discover(root).candidates, { root, timeoutMs: PROBE_TIMEOUT_MS });
    if (choice.kind !== "choice-required") throw new Error("expected the ambiguity to persist");
    const chosen = choice.candidates.find((c) => c.adapter === plan.choose?.adapter) as Candidate;
    const rebound = await resolveChoice(choice, chosen, "dev", { root, timeoutMs: PROBE_TIMEOUT_MS });
    if (rebound.kind !== "bound") throw new Error(`re-bind failed: ${JSON.stringify(rebound)}`);
    writeBindings(root, {
      bindings: [rebound.binding, ...before.filter((b) => b.slot !== plan.choose?.slot)],
      skips: readBindings(root).skips,
    });
  }

  const after = readBindings(root).bindings;
  expect(assertNoDrift(after, discover(root)).halting).toEqual([]);
  /** Drift is about the defining region, not the command: same resolved, new hash. */
  expect(after.find((b) => b.slot === plan.drift.slot)?.resolved).toBe(before.find((b) => b.slot === plan.drift.slot)?.resolved);
  expect(after.find((b) => b.slot === plan.drift.slot)?.config_hash).not.toBe(
    before.find((b) => b.slot === plan.drift.slot)?.config_hash,
  );

  const result: E2EResult = {
    root,
    detentFiles: walkFiles(stateDir(root)),
    gitignore: readFileSync(path.join(stateDir(root), ".gitignore"), "utf8"),
    bindingsJson: readFileSync(path.join(stateDir(root), "bindings.json"), "utf8"),
  };
  results.set(plan.fixture, result);
  return result;
}

describe("T-030 full adapter e2e per ecosystem (N-1, M1 exit)", () => {
  it("ts-service: node scripts, auto-bound, npm from the lockfile", async () => {
    await runE2E(PLANS[0]!);
  }, 180_000);

  it("py-service: make outranks the pyproject fallback; unittest executes", async () => {
    await runE2E(PLANS[1]!);
  }, 180_000);

  itGo("go-cli: real ambiguity resolved by a human; vet and build auto-bind", async () => {
    await runE2E(PLANS[2]!);
  }, 300_000);
});

describe("T-030 bindings-only diffs between fixtures", () => {
  const pairs = (): E2EResult[] => {
    const done = PLANS.map((p) => results.get(p.fixture)).filter((r): r is E2EResult => r !== undefined);
    expect(done.length).toBeGreaterThanOrEqual(2);
    return done;
  };

  itGo("all three fixtures completed the identical flow", () => {
    expect([...results.keys()].sort()).toEqual(["go-cli", "py-service", "ts-service"]);
  });

  it("the .detent/ trees are structurally identical — same files, same .gitignore bytes", () => {
    const done = pairs();
    for (const r of done) {
      expect(r.detentFiles).toEqual([".gitignore", "bindings.json"]);
      expect(r.gitignore).toBe(done[0]!.gitignore);
    }
  });

  it("what differs is bindings.json content, and only that", () => {
    const done = pairs();
    for (const r of done) {
      const parsed = JSON.parse(r.bindingsJson) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(["bindings", "schema_version", "skips"]);
      expect(parsed["schema_version"]).toBe(1);
    }
    /** Pairwise distinct: the ecosystem lives in the values, nowhere else. */
    for (let i = 0; i < done.length; i += 1) {
      for (let j = i + 1; j < done.length; j += 1) {
        expect(done[i]!.bindingsJson).not.toBe(done[j]!.bindingsJson);
      }
    }
  });
});

describe("T-030 zero kernel involvement (N-1)", () => {
  it("this e2e and every layer beside the kernel import nothing from it; the CLI only its entry points", () => {
    const kernelImport = /from\s+"[^"]*\/kernel\//;
    expect(readFileSync(fileURLToPath(import.meta.url), "utf8")).not.toMatch(kernelImport);
    /** adapter, fs and schemas sit beside/below the kernel: zero kernel imports. */
    for (const dir of ["adapter", "fs", "schemas"]) {
      for (const file of walkTs(path.join(SRC, dir))) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(kernelImport);
      }
    }
    /**
     * The CLI sits ABOVE the kernel in §3a — importing kernel entry points is
     * the diagram's own edge. What it must never touch is the machine or the
     * mutators, mirroring the lint zone (PRDR-059).
     */
    const forbidden = /from\s+"[^"]*\/kernel\/(machine|tickets\/mutations)/;
    for (const file of walkTs(path.join(SRC, "cli"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden);
    }
  });

  it("the kernel contains no stack strings (oracle test_kernel_contains_no_stack_strings, strengthened)", () => {
    /** Assembled from pieces so this file stays clean, exactly as the oracle did. */
    const banned = [
      ["np", "m "],
      ["pnp", "m "],
      ["yar", "n "],
      ["carg", "o "],
      ["pyte", "st"],
      ["go te", "st"],
      ["mv", "n "],
      ["grad", "le"],
    ].map((p) => p.join(""));
    for (const file of walkTs(path.join(SRC, "kernel"))) {
      const body = readFileSync(file, "utf8");
      for (const b of banned) {
        expect(body.includes(b), `${file} contains "${b.trim()}"`).toBe(false);
      }
    }
  });
});

function walkFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkTs(abs));
    else if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}
