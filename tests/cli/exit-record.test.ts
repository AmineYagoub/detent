import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RECORDED_SIGNALS, installExitRecorder } from "../../src/cli/exit-record.js";
import { acquireRunLock, lockPhaseSuffix, noteRunPhase } from "../../src/kernel/run-lock.js";

/**
 * PRDR-190 — a run that dies must say so.
 *
 * Asserted on `installExitRecorder`, the function the entry point CALLS, not on
 * the formatter beneath it. The ticket names that trap explicitly: the obvious
 * home for this is the module-level `invoked` block, which nothing can test,
 * and a record no test reaches is the V-1‴ shape — a control that exists, is
 * believed, and verifies nothing.
 */

interface Harness {
  readonly handlers: Map<string, () => void>;
  readonly written: string[];
  readonly exits: number[];
}

const harness = (phase: string | null): Harness => {
  const handlers = new Map<string, () => void>();
  const written: string[] = [];
  const exits: number[] = [];
  installExitRecorder({
    write: (t) => written.push(t),
    on: (sig, h) => handlers.set(sig, h),
    exit: (c) => exits.push(c),
    phase: () => phase,
    now: () => new Date("2026-09-09T12:00:00.000Z"),
  });
  return { handlers, written, exits };
};

describe("PRDR-190 init records that it exited", () => {
  it("registers a handler for every signal that can be caught", () => {
    const h = harness(null);
    for (const sig of RECORDED_SIGNALS) expect(h.handlers.has(sig)).toBe(true);
  });

  it("writes a record naming the signal and what was in flight", () => {
    const h = harness("planning s09 init pipeline, part one");
    h.handlers.get("SIGTERM")?.();
    expect(h.written.join("")).toContain("SIGTERM");
    expect(h.written.join("")).toContain("planning s09");
  });

  /** 128 + 15. The shell's own convention, and what the supervisor reads. */
  it("exits 143 on SIGTERM so a supervisor can classify the death", () => {
    const h = harness(null);
    h.handlers.get("SIGTERM")?.();
    expect(h.exits).toEqual([143]);
  });

  it("says so plainly when nothing was in flight", () => {
    const h = harness(null);
    h.handlers.get("SIGINT")?.();
    expect(h.written.join("")).toContain("SIGINT");
    expect(h.written.join("")).not.toContain("null");
  });

  /**
   * The `.then` branch, which was silent on every code it was handed. A line
   * that always appears at the end is what makes its absence mean something.
   */
  it("records the ordinary return too, and distinguishes 0 from a failure", () => {
    const clean = harness(null);
    const written: string[] = [];
    const recordExit = installExitRecorder({
      write: (t) => written.push(t),
      on: () => undefined,
      exit: () => undefined,
      phase: () => null,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });
    recordExit(0);
    recordExit(2);
    expect(written[0]).toContain("finished");
    expect(written[1]).toContain("code 2");
    /* An ordinary return is not a death, so it carries no resume advice. */
    expect(written.join("")).not.toContain("checkpointed");
    expect(clean.written).toEqual([]);
  });
});

/**
 * PRDR-190 criterion 3 — SIGKILL cannot be caught, so the marker on disk is
 * what makes an uncatchable death diagnosable. The lock is that marker.
 */
describe("PRDR-190 the run lock names what its holder was doing", () => {
  const roots: string[] = [];
  const freshRoot = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-phase-"));
    roots.push(root);
    return root;
  };
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("starts with no phase and records the one it is given", () => {
    const root = freshRoot();
    const lock = acquireRunLock(root);
    expect(lock.ok).toBe(true);
    const file = path.join(root, ".detent", "state", "run.lock");
    expect(JSON.parse(readFileSync(file, "utf8")).phase).toBeNull();
    noteRunPhase(root, "planning s09 init pipeline, part one");
    expect(JSON.parse(readFileSync(file, "utf8")).phase).toBe("planning s09 init pipeline, part one");
  });

  it("keeps the holder's identity when the phase advances", () => {
    const root = freshRoot();
    acquireRunLock(root, { pid: 4242, host: "somehost" });
    noteRunPhase(root, "planning s10");
    const held = JSON.parse(readFileSync(path.join(root, ".detent", "state", "run.lock"), "utf8"));
    expect(held.pid).toBe(4242);
    expect(held.host).toBe("somehost");
  });

  /** A run must not die because its own liveness marker could not be written. */
  it("is silent when there is no lock to annotate", () => {
    expect(() => noteRunPhase(freshRoot(), "planning s01")).not.toThrow();
  });

  it("renders a phase for the operator, and nothing at all without one", () => {
    expect(lockPhaseSuffix({ pid: 1, host: "h", at: "", phase: "planning s09" })).toContain("planning s09");
    expect(lockPhaseSuffix({ pid: 1, host: "h", at: "", phase: null })).toBe("");
    expect(lockPhaseSuffix(null)).toBe("");
  });
});
