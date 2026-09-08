import { writeFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, main, renderDoctor } from "../../src/cli/doctor.js";
import { buildLiveBackend } from "../../src/sessions/live.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";
import { existsSync, readFileSync } from "node:fs";
import { stateDir } from "../../src/fs/layout.js";

/** T-050 — `detent doctor` (S-5, X-1 reporting, S-3 rule forms, R-10 smoke). */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

const named = (report: Awaited<ReturnType<typeof doctor>>, name: string) =>
  report.checks.find((c) => c.name === name);

describe("PRDR-096 doctor reads the real installed SDK version", () => {
  /**
   * Every other test in this file injects `installedSdkVersion`, which is how
   * a throwing probe shipped: `require(".../package.json")` is refused by the
   * SDK's `exports` map, so `doctor` — the command whose job is to report on
   * the environment — died reporting on it, and the pin check never once ran.
   * This test deliberately omits the override.
   */
  it("resolves a version without throwing, and the pin check actually runs", async () => {
    const root = await fixture();
    const report = await doctor(root, {});
    const check = named(report, "agent-sdk-pin");
    expect(check).toBeDefined();
    expect(check?.detail).not.toContain("is not defined by");
    /* The fixture pins 0.3.258; the repo installs exactly that. */
    expect(check?.detail).toContain("0.3.258");
    expect(check?.ok).toBe(true);
  });
});

describe("T-050 pin checks (S-5)", () => {
  it("a matching SDK pin passes; a mismatch fails naming BOTH versions", async () => {
    /** fixture pins agent_sdk 0.3.258 == installed */
    const root = await fixture();
    const ok = await doctor(root, { installedSdkVersion: () => "0.3.258" });
    expect(named(ok, "agent-sdk-pin")?.ok).toBe(true);

    const bad = await doctor(root, { installedSdkVersion: () => "0.4.0" });
    const check = named(bad, "agent-sdk-pin");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("0.3.258");
    expect(check?.detail).toContain("0.4.0");
    expect(bad.exitCode).toBe(1);
  });

  it("the CLI pin rides the backend's own checkVersion, failing with its message", async () => {
    const root = await fixture();
    const backend = new MockBackend();
    /** The mock accepts any pin (version-free) — passes. */
    const ok = await doctor(root, { backend, installedSdkVersion: () => "0.3.258" });
    expect(named(ok, "claude-code-pin")?.ok).toBe(true);

    const failing = {
      ...backend,
      name: "mock",
      run: backend.run.bind(backend),
      checkVersion: async (pinned: string) => {
        throw new Error(`backend version mismatch (S-5): pinned=${pinned} installed=9.9.9`);
      },
    };
    const bad = await doctor(root, { backend: failing, installedSdkVersion: () => "0.3.258" });
    const check = named(bad, "claude-code-pin");
    expect(check?.ok).toBe(false);
    /** the pin from config */
    expect(check?.detail).toContain("2.1.191");
    expect(check?.detail).toContain("9.9.9");
  });
});

describe("T-050 config reporting (X-1: the computation is authoritative)", () => {
  it("reports the computed worst case beside the configured net", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "0.3.258" });
    const check = named(report, "config");
    expect(check?.ok).toBe(true);
    /** Moved with PRDR-108/109 (three review-fix rounds, one review relaunch per entry). */
    expect(check?.detail).toContain("computed worst case 24");
    expect(check?.detail).toContain("net 28");
  });

  it("a missing config is a failing check, not a crash", async () => {
    const root = await fixture();
    rmSync(`${root}/.detent/config.json`);
    const report = await doctor(root, { installedSdkVersion: () => "0.3.258" });
    expect(named(report, "config")?.ok).toBe(false);
    expect(report.exitCode).toBe(1);
  });
});

describe("T-050 WebFetch rule form (S-3/PRDR-050)", () => {
  it("the composed domain-scoped form matches the pinned syntax", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "0.3.258" });
    expect(named(report, "webfetch-rule-form")?.ok).toBe(true);
  });
});

describe("T-050 smoke session (R-10)", () => {
  /**
   * PRDR-141: the gate is the BACKEND, not the key. It used to test
   * `env["ANTHROPIC_API_KEY"]`, stale since the transports broadened to three,
   * and this test supplied a backend while calling itself "without a key" — so
   * it asserted the skip through a condition that no longer decides it.
   */
  it("without a live backend the smoke SKIPS with the reason — the mock suite stays green", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "0.3.258" });
    const check = named(report, "smoke-session");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("R-10");
  });

  it("with a key it runs one session and verifies telemetry parses end to end", async () => {
    const root = await fixture();
    const backend = new MockBackend({ review: () => okResult({ costEstimateUsd: 0.0003, turns: 1 }) });
    const report = await doctor(root, {
      backend,
      installedSdkVersion: () => "0.3.258"
    });
    const check = named(report, "smoke-session");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("smoke OK");
    expect(backend.calls).toHaveLength(1);
    /** read-only smoke */
    expect(backend.calls[0]?.spec.permissionMode).toBe("plan");

    const failing = new MockBackend({ review: () => okResult({ telemetryParsed: false }) });
    const bad = await doctor(root, {
      backend: failing,
      installedSdkVersion: () => "0.3.258"
    });
    expect(named(bad, "smoke-session")?.ok).toBe(false);
    expect(bad.exitCode).toBe(1);
  });

  it("renderDoctor marks failures loudly", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "9.9.9" });
    const rendered = renderDoctor(report);
    expect(rendered).toContain("[FAIL] agent-sdk-pin");
    expect(rendered).toContain("[ok] config");
  });
});

/**
 * PRDR-143: exercise `main`.
 *
 * Every case above calls `doctor(root, …)` directly with injected deps — which
 * is exactly the critique PRDR-141 made of its own predecessor, and exactly why
 * its wiring defect shipped: `main` built a live backend outside any try, so a
 * `bindings.json` it could not read killed the command before a single check
 * printed. `doctor` is the tool you reach for when the state directory is
 * broken; it must survive one.
 */
describe("PRDR-143 doctor's own entry point", () => {
  /**
   * PRDR-158: `hasAuth` is FORCED here.
   *
   * Left to the machine, this test proved nothing on any runner without live
   * auth: `hasLiveBackendAuth()` returns false, `buildLiveBackend` is never
   * called, and the corrupt fixture is never read. Reverting the fix and
   * running under `DETENT_NO_LIVE=1` — the CI environment — passed in 136ms.
   * Forcing the decision makes the assertion true everywhere or nowhere.
   */
  it("survives a bindings.json it cannot read, and still prints its offline checks", async () => {
    const root = await fixture();
    writeFileSync(path.join(root, ".detent", "bindings.json"), '{"schema_version":99}');
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      /**
       * PRDR-162: the real builder runs, and CANNOT return one.
       *
       * Handing `main` a bare `buildLiveBackend` restored the exact defect
       * PRDR-158 set out to remove, and widened it: `buildLiveBackend` returns
       * a real ClaudeCodeBackend on a valid bindings.json AND on a missing one,
       * so the only thing between `npm test` and a billed `maxTurns: 1` session
       * was again the corrupt fixture on the line above — now reached on every
       * machine, CI included, because `hasAuth` is forced. Here the builder
       * either throws (the property under test) or this throws for it, so no
       * path reaches `backend.run`, and `builderThrew` is what says which
       * happened — `main` catches both, so the stderr line alone cannot tell
       * them apart.
       */
      let builderThrew: unknown = null;
      await main([root, "--smoke"], {
        hasAuth: () => true,
        buildBackend: (r): SessionBackend => {
          try {
            buildLiveBackend(r);
          } catch (e) {
            builderThrew = e;
            throw e;
          }
          throw new Error("buildLiveBackend returned a live backend on an unreadable bindings.json");
        },
      });
      const printed = out.mock.calls.join("");
      expect(printed, "doctor must still report").toContain("detent doctor");
      expect(printed).toContain("config");
      expect(err.mock.calls.join(""), "and must say why the live checks are missing").toContain("live checks unavailable");
      expect(builderThrew, "the REAL builder must be what refused, not this test's backstop").toBeInstanceOf(Error);
      expect((builderThrew as Error).message).toContain("schema_version 99");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  /**
   * PRDR-158: the suite must not be able to spend, and not because a fixture
   * happens to be corrupt.
   *
   * With a VALID bindings.json — which `makeRunRepo` writes — `buildLiveBackend`
   * succeeds on any logged-in machine, and `doctor` then runs a real billed
   * `maxTurns: 1` session. The only thing that used to prevent it was the
   * `{"schema_version":99}` line in the test above. This asserts the seam
   * instead: the backend `main` uses is the one it was handed.
   */
  it("spends only through the backend it is given, never one it builds itself", async () => {
    const root = await fixture();
    let ran = 0;
    const fake = {
      name: "fake",
      checkVersion: async () => undefined,
      run: async () => {
        ran += 1;
        return okResult({ telemetryParsed: true });
      },
    } as unknown as SessionBackend;
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await main([root, "--smoke"], { hasAuth: () => true, buildBackend: () => fake });
      expect(ran, "the injected backend is the one that ran").toBe(1);
      expect(out.mock.calls.join(""), "and its result is what doctor reports").toContain("smoke OK");
      /**
       * X-1 (PRDR-173): and it left a ledger row. This was the only
       * `backend.run` site in the repo with no ledger wrapping — a real,
       * consented, billed session that `.detent/ledger.jsonl` never heard
       * about; the file was not even created.
       */
      const ledger = path.join(stateDir(root), "ledger.jsonl");
      expect(existsSync(ledger), "a billed session must leave a row").toBe(true);
      const rows = readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(rows.map((r) => r["role"]), "named as the smoke session, not a ticket's work").toContain("doctor-smoke");
    } finally {
      out.mockRestore();
    }
  });

  it("does not spend without --smoke: the live checks report as skipped", async () => {
    const root = await fixture();
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await main([root]);
      expect(out.mock.calls.join(""), "a bare `detent doctor` must stay offline").toContain("skipped");
    } finally {
      out.mockRestore();
    }
  });
});
