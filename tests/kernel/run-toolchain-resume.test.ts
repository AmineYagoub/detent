import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBindings, writeBindings } from "../../src/adapter/drift.js";
import { EXIT_ERROR, EXIT_HUMAN_GATED, EXIT_NOT_READY, EXIT_OK, run, type RunOptions } from "../../src/kernel/run.js";
import { ensureToolchains } from "../../src/kernel/run-toolchain.js";
import { requeueOnInstall } from "../../src/kernel/referee-sweeps.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { appendNote } from "../../src/kernel/tickets/mutations.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, tmpTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-277 — a ticket its session stopped on a false premise (X-4) goes back
 * to the queue on the same yes that installs the toolchain `run` found
 * missing, and the run moves on to it.
 *
 * ksar-cloud's shape: run 7 falsified t-001-bootstrap for want of Go, and every
 * other ticket waits on it. The first run here leaves `t1` exactly there; the
 * second binds the test gate to Go. A stand-in `go` that runs the fixture's own
 * test script goes first on PATH, so the gate a returned ticket reaches runs the
 * same on every host, with or without a real Go.
 */

const PROMPTS = loadPromptSet();
const INSTALL_GO = process.platform === "darwin" ? "brew install go" : "sudo apt-get install -y golang-go";
const PREMISE = "Environment precondition unmet: there is no Go toolchain on this machine";
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const r of roots.splice(0)) removeTree(r);
});

/** The session writes the signal and builds nothing, as t-001's did. */
const falsify: StageFn = (spec) => {
  const variable = JSON.parse(spec.promptVariable) as { falsified_out: string };
  writeTree(path.dirname(variable.falsified_out), { [path.basename(variable.falsified_out)]: JSON.stringify({ note: PREMISE }) });
  return okResult();
};

/** Run 7's end state, then Go bound to the test gate, with a stand-in `go` on PATH. */
async function stranded(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  addTicket(root, { id: "t1" });
  const first = await run({ root, backend: new MockBackend({ implement: falsify }), prompts: PROMPTS, runId: "first" });
  if (first.exitCode !== EXIT_HUMAN_GATED) throw new Error(`the fixture expects a falsified t1, got exit ${first.exitCode}`);

  /** ksar's binding: greenfield and provisional, so discovery has no candidate to call it drift against (C-4). */
  const current = readBindings(root);
  writeBindings(root, {
    bindings: current.bindings.map((b) =>
      b.slot === "test" ? { ...b, adapter: "greenfield:go", ref: "go test", resolved: "go test ./...", status: "provisional" as const } : b,
    ),
    skips: [...current.skips],
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "bind the test gate to go");

  const bin = tmpTree({ go: "#!/bin/sh\nexec sh scripts/test.sh\n" });
  roots.push(bin);
  chmodSync(path.join(bin, "go"), 0o755);
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`);
  return root;
}

/** A host where `go` resolves only once the approved install has run. */
function host(): { readonly ran: string[]; readonly opts: Partial<RunOptions> } {
  const ran: string[] = [];
  let installed = false;
  return {
    ran,
    opts: {
      toolchainProbe: () => installed,
      toolchainInstall: (exe, args) => {
        ran.push([exe, ...args].join(" "));
        installed = true;
      },
    },
  };
}

function second(root: string, over: Partial<RunOptions>): Promise<Awaited<ReturnType<typeof run>>> {
  return run({
    root,
    backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
    prompts: PROMPTS,
    runId: "second",
    ...over,
  });
}

function transitionsOf(root: string, id: string): Record<string, unknown>[] {
  return readFileSync(path.join(root, ".detent", "transitions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((t) => t["ticket"] === id);
}

describe("PRDR-277 the yes that installs the toolchain returns what a false premise stranded", () => {
  it("the stranded ticket is requeued, the same run claims it, and it reaches DONE", async () => {
    const root = await stranded();
    const h = host();
    const asked: string[] = [];
    const outcome = await second(root, {
      ...h.opts,
      approveToolchain: async (message) => {
        asked.push(message);
        return true;
      },
    });
    expect(h.ran).toEqual([INSTALL_GO]);
    expect(outcome.exitCode, JSON.stringify(outcome.summary)).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(asked[0], "the question names the ticket a yes returns").toContain("t1");
    expect(asked[0], "and the premise its session found false").toContain(PREMISE);
    expect(asked[0], "in the session's words, not the kernel's prefix").not.toContain("falsified mid-implementation:");
    const requeue = transitionsOf(root, "t1").find((t) => t["event"] === "HUMAN_REQUEUE");
    expect(requeue, "a human act, and the act is the install's yes").toMatchObject({ from: "NEEDS_HUMAN", to: "READY" });
    expect(String(requeue?.["evidence"])).toContain(INSTALL_GO);
    expect(JSON.stringify(readTicket(root, "t1").notes)).toContain("PRDR-277");
    const generations = readTicket(root, "t1").generations;
    expect(generations, "a fresh attempt, not the old one resumed").toHaveLength(2);
    expect(generations[1]?.reason).toContain(INSTALL_GO);
    expect(generations[1]?.reason, "and it carries the premise it re-tests").toContain(PREMISE);
  });

  it("a returned ticket whose premise is still false goes back to its human, once — no loop", async () => {
    const root = await stranded();
    const h = host();
    const backend = new MockBackend({ implement: falsify, review: reviewApprove });
    /** Bounded, so a yes spent at every draw fails here instead of looping for ever. */
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "second", maxTickets: 3, ...h.opts, approveToolchain: async () => true });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(backend.calls.filter((c) => c.role === "implement"), "one fresh attempt, and the yes is spent").toHaveLength(1);
  });

  it("with no one to ask, nothing is installed, nothing is returned, and the refusal says what a yes returns", async () => {
    const root = await stranded();
    const h = host();
    const outcome = await second(root, h.opts);
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(h.ran).toEqual([]);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(outcome.summary.reason).toContain("t1");
  });

  it("a declined install returns nothing", async () => {
    const root = await stranded();
    const h = host();
    const outcome = await second(root, { ...h.opts, approveToolchain: async () => false });
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
  });

  it("a ticket a person has touched since its falsification is left to that person", async () => {
    const root = await stranded();
    appendNote(root, "t1", { author: "operator", text: "looking at this one myself" });
    const h = host();
    const asked: string[] = [];
    const outcome = await second(root, {
      ...h.opts,
      approveToolchain: async (message) => {
        asked.push(message);
        return true;
      },
    });
    expect(h.ran, "the install is still the answer to the install").toEqual([INSTALL_GO]);
    expect(asked[0], "a ticket the yes will not return is not offered").not.toContain("t1");
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
  });

  it("a ticket unreadable while the question is written is the loop's kernel error, and nothing is installed", async () => {
    const root = await stranded();
    writeFileSync(path.join(root, ".detent", "plan", "t1.json"), "{ not json");
    const h = host();
    const outcome = await second(root, { ...h.opts, approveToolchain: async () => true });
    expect(outcome.exitCode, "C-11: exit 1 with the reason, as the loop reports the same file").toBe(EXIT_ERROR);
    expect(outcome.summary.reason).toContain("t1");
    expect(h.ran).toEqual([]);
  });

  it("with the toolchain already present, nothing is asked and nothing is returned", async () => {
    const root = await stranded();
    let asked = 0;
    const outcome = await second(root, {
      toolchainProbe: () => true,
      toolchainInstall: () => undefined,
      approveToolchain: async () => {
        asked += 1;
        return true;
      },
    });
    expect(asked).toBe(0);
    expect(outcome.exitCode, "D-36: a leftover escalation with nothing installed is still the operator's").toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
  });
});

describe("PRDR-277 what the question says", () => {
  const GO_BOUND = [{ slot: "test", resolved: "go test ./..." }];
  const T1 = { id: "t-001-bootstrap", reason: `${PREMISE}, so acceptance criteria 2-4 are unimplementable` };

  it("lists each ticket a yes returns with its premise, after what the yes installs", async () => {
    const shown: string[] = [];
    const outcome = await ensureToolchains(
      GO_BOUND,
      { platform: "darwin", probe: () => false, install: () => undefined, announce: (m) => void shown.push(m), approve: async () => false },
      () => [T1],
    );
    expect(outcome.ready).toBe(false);
    const message = shown[0] ?? "";
    expect(message.indexOf("t-001-bootstrap"), "the ticket is named").toBeGreaterThan(message.indexOf("brew install go"));
    expect(message).toContain(PREMISE);
  });

  it("an install that resolves hands back exactly the tickets it named, and what it installed", async () => {
    let installed = false;
    const outcome = await ensureToolchains(
      GO_BOUND,
      { platform: "darwin", probe: () => installed, install: () => void (installed = true), approve: async () => true },
      () => [T1],
    );
    if (!outcome.ready) throw new Error(outcome.reason);
    expect(outcome.resume).toEqual({ ids: ["t-001-bootstrap"], installed: "go (brew install go)" });
  });

  it("nothing to install, nothing to hand back", async () => {
    const outcome = await ensureToolchains(GO_BOUND, { platform: "darwin", probe: () => true }, () => [T1]);
    if (!outcome.ready) throw new Error(outcome.reason);
    expect(outcome.resume).toBeNull();
  });
});

describe("PRDR-277 only what the question named, and only while it is still stranded", () => {
  const RESUME = { ids: ["t1"], installed: "go (brew install go)" };
  const at = "2026-09-23T15:00:00.000Z";

  it("a stranded ticket the question did not name is not returned", async () => {
    const root = await stranded();
    const committed: string[] = [];
    const returned = requeueOnInstall(root, (t, e) => (committed.push(e.event), { ...t, state: "READY" }), at, { ...RESUME, ids: ["t9"] });
    expect(returned).toEqual([]);
    expect(committed).toEqual([]);
  });

  it("a named ticket a person touched after the question was shown is left to that person", async () => {
    const root = await stranded();
    appendNote(root, "t1", { author: "operator", text: "mine now" });
    const committed: string[] = [];
    const returned = requeueOnInstall(root, (t, e) => (committed.push(e.event), { ...t, state: "READY" }), at, RESUME);
    expect(returned).toEqual([]);
    expect(committed).toEqual([]);
  });
});
