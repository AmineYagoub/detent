import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { main } from "../../src/cli/init.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";


/**
 * Port of the oracle's `test_extra.py::test_mode1_stub_detected` (T-060).
 *
 * The reference reads git-presence *as* the greenfield signal: a PRD-only
 * folder with no `.git` is "mode 1", and mode-1 bootstrap is a stub that just
 * prints a note and returns 2. Detent deliberately separates the two questions
 * the oracle conflates — C-1 requires a git root, and greenfield (D-10) is the
 * absence of *stack markers* inside a repo, decided later in ANALYZE. But the
 * behaviour this test guards survives the split intact: a PRD-only, non-git
 * folder is detected as not-a-runnable-project and `detent init` returns
 * EXIT_NOT_READY (2) rather than pretending it can build — exactly as the
 * oracle's mode 1 returned 2, and needing no live backend to say so.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

describe("T-060 mode-1 parity: a PRD-only, non-git folder is not a runnable project", () => {
  it("`detent init` on it returns exit 2 and creates no .detent/ (oracle test_mode1_stub_detected)", async () => {
    const root = tmpTree({ "PRD.md": "# product\n" });
    roots.push(root);

    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      /** The oracle's exact scenario: PRD.md, no `.git`. It returned 2; so do we. */
      expect(await main([root])).toBe(2);
      expect(err.mock.calls.join("")).toMatch(/not a git repository/);
    } finally {
      err.mockRestore();
    }

    /** C-1's refusal is pure: nothing is written into the folder it declined. */
    expect(existsSync(path.join(root, ".detent"))).toBe(false);
  });
});

/**
 * X-1‴ (PRDR-168) — one pipeline per root.
 *
 * `acquireRunLock` was built for PRDR-147's "two runs jointly spend past the
 * ceiling" and wired to `detent run` alone. `init` is the first command an
 * operator runs, and the one whose sessions cannot use the fixture backend —
 * so its sessions are the first genuinely billed ones in a project's life.
 */
describe("X-1‴ init refuses a root another process is already planning", () => {
  it("refuses, names the holder, and does not run the pipeline", async () => {
    const root = tmpTree({ "PRD.md": "# product\n", "package.json": '{"name":"x","scripts":{"test":"vitest run"}}\n' });
    roots.push(root);
    gitInit(root);
    /* A live lock held by a pid that IS alive — this process. */
    const held = acquireRunLock(root, { pid: process.pid, host: "otherhost" });
    expect(held.ok, "the fixture lock must have been taken").toBe(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const code = await main([root]);
      expect(code, "a second init on a held root must refuse (C-11 exit 2)").toBe(2);
      expect(err.mock.calls.join(""), "and must say who holds it").toContain("another run holds this root");
    } finally {
      err.mockRestore();
      if (held.ok) held.release();
    }
  });
});

/**
 * C-1 (PRDR-179) — a refusal leaves nothing behind.
 *
 * PRDR-168's lock mkdirs `.detent/state/` and its `release()` removes only the
 * lock file, so a refusal AFTER the lock would leave a `.detent/` on a
 * directory Detent declined to work on. The rule's existing test exercises the
 * no-repo path, which returns before the lock either way — kept true by a
 * coincidental fixture rather than by an assertion.
 */
describe("C-1 a refused init creates no .detent/", () => {
  it("leaves the directory untouched when it is not a git root", async () => {
    const root = tmpTree({ "PRD.md": "# product\n" });
    roots.push(root);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main([root])).toBe(2);
    } finally {
      err.mockRestore();
    }
    expect(existsSync(path.join(root, ".detent")), "a refusal must not initialise anything").toBe(false);
  });

  it("leaves the directory untouched when it is a subdirectory of a repo", async () => {
    const root = tmpTree({ "PRD.md": "# product\n" });
    roots.push(root);
    gitInit(root);
    const sub = path.join(root, "packages", "app");
    mkdirSync(sub, { recursive: true });
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main([sub])).toBe(2);
    } finally {
      err.mockRestore();
    }
    expect(existsSync(path.join(sub, ".detent")), "a refusal must not initialise anything").toBe(false);
  });
});

/**
 * PRDR-197 — the CLI hands the pipeline what config carries.
 *
 * `cli/init.ts` passed `modelRouting` and not `effortRouting`, so the knob was
 * validated at config load and reached no init session: dead on one driver,
 * working on the other. The audit found it; no test did, because `main` builds
 * its own live backend and cannot be driven to a session here.
 *
 * So this reads the module, on the precedent of `tests/oracle/budgets.test.ts`,
 * which requires an enforcement site to MENTION its ceiling rather than letting
 * a doc comment vouch for the code. Weak evidence, and it is the evidence that
 * would have caught this.
 */
describe("PRDR-197 the CLI forwards both routings", () => {
  it("passes effort_routing as well as model_routing into the pipeline", () => {
    const source = readFileSync("src/cli/init.ts", "utf8");
    expect(source).toContain("modelRouting: config?.model_routing");
    expect(source).toContain("effortRouting: config?.effort_routing");
  });
});

/**
 * PRDR-263 — the effort default is announced like the model default.
 *
 * Same weak-but-real evidence as the case above, and for the same reason:
 * `main` builds its own live backend and cannot be driven to a session here.
 * PRDR-142 recorded what an unannounced default costs — a role routed to the
 * runtime default forever, with nothing printed.
 */
describe("PRDR-263 the CLI announces the effort routing", () => {
  it("names the levels on a first init", () => {
    const source = readFileSync("src/cli/init.ts", "utf8");
    expect(source, "a default an operator cannot see is one they do not have").toContain("effort routing defaulted");
    expect(source, "the planner's level is the one worth naming outright").toContain("planner → max");
  });
});
