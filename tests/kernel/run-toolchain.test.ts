import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBindings, writeBindings } from "../../src/adapter/drift.js";
import { EXIT_NOT_READY, EXIT_OK, run, type RunOptions } from "../../src/kernel/run.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-276 — `run` checks the toolchain behind every bound gate, and installs
 * a missing one only on the operator's answer.
 *
 * These drive `run` over a plan with NO tickets wherever the run is meant to
 * proceed: every precondition, including the toolchain, runs; no gate does. A
 * gate bound to `go test ./...` would otherwise execute a real `go` on
 * whatever host runs the suite. Where the run is meant to refuse, the plan has
 * a ticket, so a refusal that came too late would show as a session launched.
 */

const PROMPTS = loadPromptSet();
const INSTALL_GO = process.platform === "darwin" ? "brew install go" : "sudo apt-get install -y golang-go";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** The fixture, with its `test` gate rebound — to Go, as ksar-cloud's is, unless a test says otherwise. */
async function repoBoundTo(command = "go test ./..."): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  const current = readBindings(root);
  writeBindings(root, {
    bindings: current.bindings.map((b) => (b.slot === "test" ? { ...b, resolved: command } : b)),
    skips: [...current.skips],
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", `bind the test gate to ${command}`);
  return root;
}

/** A host without the toolchain until something installs it, and a record of every install run on it. */
function host(installWorks = true): {
  readonly ran: string[];
  readonly probed: string[];
  readonly probe: (exe: string) => boolean;
  readonly install: (exe: string, args: readonly string[]) => void;
} {
  const ran: string[] = [];
  const probed: string[] = [];
  let installed = false;
  return {
    ran,
    probed,
    probe: (exe) => {
      probed.push(exe);
      return installed;
    },
    install: (exe, args) => {
      ran.push([exe, ...args].join(" "));
      installed = installWorks;
    },
  };
}

function opts(root: string, backend: MockBackend, h: ReturnType<typeof host>, over: Partial<RunOptions> = {}): RunOptions {
  return {
    root,
    backend,
    prompts: PROMPTS,
    runId: "toolchain",
    toolchainProbe: h.probe,
    toolchainInstall: h.install,
    ...over,
  };
}

describe("PRDR-276 run checks the bound gates' toolchains before it spends", () => {
  it("an approved install runs the table's command, and the run proceeds", async () => {
    const root = await repoBoundTo();
    const h = host();
    const asked: string[] = [];
    const outcome = await run(
      opts(root, new MockBackend(), h, {
        approveToolchain: async (message) => {
          asked.push(message);
          return true;
        },
      }),
    );
    expect(h.ran, "the command the operator approved, from Detent's own table").toEqual([INSTALL_GO]);
    expect(asked[0], "the question names what a yes would run, and for which slot").toContain(INSTALL_GO);
    expect(asked[0]).toContain("go — needed by test");
    expect(outcome.exitCode).toBe(EXIT_OK);
  });

  it("with no one to ask, the run refuses before any session launches", async () => {
    const root = await repoBoundTo();
    addTicket(root, { id: "t1" });
    const h = host();
    const backend = new MockBackend();
    const outcome = await run(opts(root, backend, h));
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(h.ran).toEqual([]);
    expect(backend.calls, "nothing spent discovering what one probe answers").toHaveLength(0);
    expect(outcome.summary.reason, "the refusal names the command and the flag that answers it").toContain(INSTALL_GO);
    expect(outcome.summary.reason).toContain("detent run --install-toolchain");
  });

  it("a declined install runs nothing, and the run refuses", async () => {
    const root = await repoBoundTo();
    addTicket(root, { id: "t1" });
    const h = host();
    const backend = new MockBackend();
    const outcome = await run(opts(root, backend, h, { approveToolchain: async () => false }));
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(h.ran).toEqual([]);
    expect(backend.calls).toHaveLength(0);
    expect(outcome.summary.reason).toContain("declined");
  });

  it("an install that leaves nothing runnable refuses, naming what it tried", async () => {
    const root = await repoBoundTo();
    addTicket(root, { id: "t1" });
    const h = host(false);
    const backend = new MockBackend();
    const outcome = await run(opts(root, backend, h, { approveToolchain: async () => true }));
    expect(h.ran, "it was run").toEqual([INSTALL_GO]);
    expect(outcome.exitCode, "and not believed: the re-probe decides").toBe(EXIT_NOT_READY);
    expect(backend.calls).toHaveLength(0);
    expect(outcome.summary.reason).toContain("did not resolve");
    expect(outcome.summary.reason).toContain(`go: ${INSTALL_GO} — install reported success but the executable still does not run`);
  });

  it("a machine that has the toolchain is not asked, and nothing is installed", async () => {
    const root = await repoBoundTo();
    const ran: string[] = [];
    let asked = 0;
    const outcome = await run({
      root,
      backend: new MockBackend(),
      prompts: PROMPTS,
      runId: "toolchain",
      toolchainProbe: () => true,
      toolchainInstall: (exe) => void ran.push(exe),
      approveToolchain: async () => {
        asked += 1;
        return true;
      },
    });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(asked).toBe(0);
    expect(ran).toEqual([]);
  });

  it("a head the table does not know is never probed, never installed — the gate finds out", async () => {
    const root = await repoBoundTo("./scripts/test.sh");
    const h = host();
    let asked = 0;
    const outcome = await run(
      opts(root, new MockBackend(), h, {
        approveToolchain: async () => {
          asked += 1;
          return true;
        },
      }),
    );
    expect(h.probed, "a project script is not executed to answer a toolchain question").toEqual([]);
    expect(asked).toBe(0);
    expect(h.ran).toEqual([]);
    expect(outcome.exitCode).toBe(EXIT_OK);
  });

  it("each install is journaled beside the configuration the run loaded", async () => {
    const root = await repoBoundTo();
    const outcome = await run(opts(root, new MockBackend(), host(), { approveToolchain: async () => true }));
    expect(outcome.exitCode).toBe(EXIT_OK);
    const events = runEvents(root);
    const install = events.find((e) => e["event"] === "toolchain_install");
    expect(install).toMatchObject({ exe: "go", command: INSTALL_GO, resolved: true, detail: "installed and resolves" });
    expect(
      events.findIndex((e) => e["event"] === "toolchain_install"),
      "after the config event: both describe what this run ran under",
    ).toBeGreaterThan(events.findIndex((e) => e["event"] === "config"));
  });

  it("a run S-5 refuses installs nothing — the pin is checked first", async () => {
    const root = await repoBoundTo();
    const h = host();
    let asked = 0;
    const backend = new MockBackend();
    backend.checkVersion = async (): Promise<void> => {
      throw new Error("S-5: claude_code pinned 2.1.191, backend reports 9.9.9");
    };
    const outcome = await run(
      opts(root, backend, h, {
        approveToolchain: async () => {
          asked += 1;
          return true;
        },
      }),
    );
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("S-5");
    expect(asked, "a machine is not changed for a run that was never going to start").toBe(0);
    expect(h.ran).toEqual([]);
  });

  it("the question is asked before the run lock is taken", async () => {
    const root = await repoBoundTo();
    const lock = path.join(root, ".detent", "state", "run.lock");
    const heldWhileAsking: boolean[] = [];
    await run(
      opts(root, new MockBackend(), host(), {
        approveToolchain: async () => {
          heldWhileAsking.push(existsSync(lock));
          return true;
        },
      }),
    );
    expect(heldWhileAsking, "a refusal here touches nothing, as every precondition's does").toEqual([false]);
  });
});

function runEvents(root: string): Record<string, unknown>[] {
  const file = path.join(root, ".detent", "runs", "run", "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
