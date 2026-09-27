import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidate } from "../../src/adapter/discover/types.js";
import { checkAll, readBindings, writeBindings } from "../../src/adapter/drift.js";
import { ROOT_PACKAGE, discoverPackages, gateLabel, packageCandidates } from "../../src/adapter/packages.js";
import type { Ecosystem } from "../../src/adapter/install.js";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import { determineVerification } from "../../src/init/bind.js";
import { verifySync } from "../../src/cli/verify.js";
import { finalizeBootstrap } from "../../src/init/plan.js";
import { BOOTSTRAP_TICKET_ID } from "../../src/init/plan-write.js";
import { presentStage } from "../../src/init/present.js";
import { EXIT_NOT_READY, EXIT_OK, run } from "../../src/kernel/run.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { Binding } from "../../src/schemas/records.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, gitInit, tmpTree, writeTree } from "../helpers.js";
import { noopFix, researchValid, reviewApprove } from "../kernel/run-fixture.js";
import { NOW, dropScratch, implementIn, lines, planned, ran, scratch, twoPackages } from "./packages-fixture.js";

/**
 * V-5′ (PRDR-295) — gates bind per package.
 *
 * Root-only binding (D-5, V-5, NG2) left a ticket whose surface lay in another
 * package with no gate that could fail: 69 of ksar-cloud's tickets wrote
 * `dashboard/`, a Node package, and its gates ran Go at the root. Each package
 * is bound in its own directory, a ticket's gates are its packages', and a
 * ticket writing where no package has a gate is not approvable.
 */

const PROMPTS = loadPromptSet();
afterEach(dropScratch);

describe("V-5′ DETERMINE_VERIFICATION binds every package", () => {
  it("binds each package's gates in its own directory, and records the packages, the bindings and the skips per package", async () => {
    const { root, log } = twoPackages();
    const outcome = await determineVerification({ root, greenfield: false, acknowledgedBy: "fixture", now: NOW });
    expect(outcome.kind).toBe("complete");

    const file = readBindings(root);
    expect(file.packages).toEqual([".", "web"]);
    expect(file.bindings.map((b) => `${b.package} ${b.slot} ${b.resolved}`)).toEqual([". test make test", ". lint make lint", "web test make test"]);
    const real = realpathSync(root);
    expect(lines(log), "V-1: each executed before it binds, in its package's directory").toEqual([
      `root test ${real}`,
      `root lint ${real}`,
      `web test ${path.join(real, "web")}`,
    ]);
    expect(file.skips.map((s) => `${s.package} ${s.slot}`)).toEqual([
      ". test_single",
      ". typecheck",
      ". build",
      ". e2e",
      "web test_single",
      "web lint",
      "web typecheck",
      "web build",
      "web e2e",
    ]);
  });

  it("a package with no candidate binds nothing, and asks nothing while another package can run tests", async () => {
    const { root } = twoPackages({ "admin/package.json": '{"name":"admin"}\n' });
    const outcome = await determineVerification({ root, greenfield: false, acknowledgedBy: "fixture", now: NOW });
    expect(outcome.kind).toBe("complete");
    const file = readBindings(root);
    expect(file.packages).toEqual([".", "admin", "web"]);
    expect(file.bindings.filter((b) => b.package === "admin")).toEqual([]);
    expect(file.skips.filter((s) => s.package === "admin"), "nothing was left unbound on purpose: it has no gate").toEqual([]);
  });

  it("binds an existing project whose root runs no tests while a package does, and asks for a test command only where no package has one", async () => {
    const rootLintOnly = { Makefile: ".PHONY: lint\n\nlint:\n\tsh scripts/gate.sh lint\n" };
    const { root } = twoPackages(rootLintOnly);
    const outcome = await determineVerification({ root, greenfield: false, acknowledgedBy: "fixture", now: NOW });
    expect(outcome.kind).toBe("complete");
    expect(readBindings(root).bindings.map((b) => gateLabel(b))).toEqual(["lint", "web:test"]);
    expect(readBindings(root).skips.map((s) => gateLabel(s)), "a required slot is never an acknowledged gap").not.toContain("test");

    const none = twoPackages({ ...rootLintOnly, "web/Makefile": ".PHONY: lint\n\nlint:\n\tsh gate.sh lint\n" });
    const refused = await determineVerification({ root: none.root, greenfield: false, acknowledgedBy: "fixture", now: NOW });
    expect(refused.kind === "interrupt" ? refused.interrupt : refused.kind).toBe("AWAIT_SETUP_CONSENT");
    expect(refused.kind === "interrupt" ? refused.items : []).toEqual(["test"]);
  });

  it("names the package whose sole candidate cannot be bound", async () => {
    const { root } = twoPackages({ "web/Makefile": ".PHONY: test\n\ntest:\n\tsleep 30\n" });
    const outcome = await determineVerification({ root, greenfield: false, acknowledgedBy: "fixture", now: NOW, timeoutMs: 3_000 });
    expect(outcome.kind === "interrupt" ? outcome.interrupt : outcome.kind).toBe("AWAIT_SETUP_CONSENT");
    expect(outcome.kind === "interrupt" ? outcome.items : []).toEqual(["web:test"]);
  });

  it("binds a pack's declared packages as the pack declares them, provisionally, in a new project", async () => {
    const root = tmpTree();
    scratch.push(root);
    gitInit(root);
    initLayout(root);
    const outcome = await determineVerification({
      root,
      greenfield: true,
      now: NOW,
      stack: { decision: "D-1", language: "TypeScript", toolchain: "Node 22", scaffold_files: ["package.json"], gates: { test: "npm test", lint: "npm run lint" } },
      packages: [
        { path: ".", gates: { test: "npm test", lint: "npm run lint" } },
        { path: "web", gates: { test: "pnpm test", typecheck: "pnpm exec tsc --noEmit" } },
      ],
    });
    expect(outcome.kind).toBe("complete");
    const file = readBindings(root);
    expect(file.packages).toEqual([".", "web"]);
    expect(file.bindings.map((b) => [b.package, b.slot, b.resolved, b.status, b.adapter])).toEqual([
      [".", "test", "npm test", "provisional", "greenfield:typescript"],
      [".", "lint", "npm run lint", "provisional", "greenfield:typescript"],
      ["web", "test", "pnpm test", "provisional", "declared"],
      ["web", "typecheck", "pnpm exec tsc --noEmit", "provisional", "declared"],
    ]);
  });

  it("in an existing project, binds a declared package that no manifest backs as the pack declares it, and says where the pack and a package's manifest disagree", async () => {
    const { root } = twoPackages();
    const notes: string[] = [];
    const outcome = await determineVerification({
      root,
      greenfield: false,
      acknowledgedBy: "fixture",
      now: NOW,
      note: (text) => notes.push(text),
      packages: [
        { path: "admin", gates: { test: "npm test" } },
        { path: "web", gates: { test: "npm test" } },
      ],
    });
    expect(outcome.kind).toBe("complete");
    const file = readBindings(root);
    expect(file.packages).toEqual([".", "admin", "web"]);
    expect(file.bindings.filter((b) => b.package !== ".").map((b) => [b.package, b.slot, b.resolved, b.status])).toEqual([
      ["admin", "test", "npm test", "provisional"],
      ["web", "test", "make test", "approved"],
    ]);
    const said = notes.join("\n");
    expect(said).toContain("web:test");
    expect(said).toContain("`npm test`");
    expect(said).toContain("`make test`");
    const outputs = outcome.kind === "complete" ? outcome.outputs : {};
    expect(outputs["gate_notices"]).toEqual(notes);
    expect(outputs["packages"], "the phase's output lists the declared package too").toEqual([".", "admin", "web"]);
  });
});

describe("V-5′ a ticket's gates are those of the packages its surface touches", () => {
  it("runs only the gates of the package a ticket's surface lies in, in that package's directory", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const backend = new MockBackend({ implement: implementIn({ t1: ["web/src"] }), review: reviewApprove });
    const outcome = await run({ root: repo.root, backend, prompts: PROMPTS, runId: "one-package", ecosystems: [] });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(repo.root, "t1").state).toBe("DONE");
    expect(ran(repo.log)).toEqual(new Set(["web test"]));
    expect(lines(repo.log).every((l) => l.endsWith("/web")), "each in the package's own directory").toBe(true);
  }, 60_000);

  it("runs the gates of every package a ticket's surface touches", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t2", surface: ["src/**", "web/src/**"] }]);
    const backend = new MockBackend({ implement: implementIn({ t2: ["src", "web/src"] }), review: reviewApprove });
    const outcome = await run({ root: repo.root, backend, prompts: PROMPTS, runId: "two-packages", ecosystems: [] });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(repo.root, "t2").state).toBe("DONE");
    expect(ran(repo.log)).toEqual(new Set(["root lint", "root test", "web test"]));
  }, 60_000);

  it("a red gate in the ticket's package holds it, while the untouched package's state is not its concern", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const failing: StageFn = (spec) => {
      writeTree(spec.cwd, { "web/.fail": "web is red\n", "web/src/feature-t1.txt": "attempt\n" });
      git(spec.cwd, "add", "web/src");
      git(spec.cwd, "commit", "-q", "-m", "t1: attempt");
      return okResult();
    };
    const backend = new MockBackend({ implement: failing, blind_fix: noopFix, research: researchValid, informed_fix: noopFix, review: reviewApprove });
    await run({ root: repo.root, backend, prompts: PROMPTS, runId: "red-package", ecosystems: [] });
    expect(readTicket(repo.root, "t1").state).not.toBe("DONE");
    expect(ran(repo.log).has("root test"), "the root's gates never ran for it").toBe(false);
    const failure = readFileSync(path.join(repo.root, ".detent/runs/t1/last_failure.json"), "utf8");
    expect(failure).toContain("web is red");
    expect(JSON.parse(failure)).toMatchObject({ package: "web" });
  }, 60_000);

  it("installs what a touched package's manifest declares in that package's directory, with its own package manager, and keeps it off the branch", async () => {
    const fake: Ecosystem = {
      name: "fake",
      manifest: "package.json",
      lockfile: "pnpm-lock.yaml",
      dir: "node_modules",
      stamp: path.join("node_modules", ".installed"),
      install: "mkdir -p node_modules && touch node_modules/.installed && echo installed",
      pms: ["pnpm"],
    };
    const repo = twoPackages({
      "web/Makefile": ".PHONY: test\n\ntest:\n\ttest -f node_modules/.installed && sh gate.sh test\n",
      /* The root has no lockfile; web's own says pnpm, which is the one manager this row installs with. */
      "web/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const backend = new MockBackend({ implement: implementIn({ t1: ["web/src"] }), review: reviewApprove });
    const outcome = await run({ root: repo.root, backend, prompts: PROMPTS, runId: "install", ecosystems: [fake] });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(repo.root, "t1").state).toBe("DONE");
    const installs = lines(path.join(repo.root, ".detent/runs/t1/journal.jsonl")).filter((l) => l.includes('"event":"install"'));
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('"package":"web"');
    const branch = git(repo.root, "branch", "--list", "detent/run-*").trim().replace(/^\*?\s*/, "");
    const tree = git(repo.root, "ls-tree", "-r", "--name-only", branch);
    expect(tree).toContain("web/src/feature-t1.txt");
    expect(tree, "the package's install directory is not part of the change set").not.toContain("node_modules");
  }, 60_000);

  it("halts on a change to a package's gate that no one executed, naming the package, and `verify sync` returns the ticket to the pool", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    writeTree(repo.root, { "web/Makefile": ".PHONY: test\n\ntest:\n\tsh gate.sh test && echo changed\n" });
    git(repo.root, "add", "web/Makefile");
    git(repo.root, "commit", "-q", "-m", "web's test recipe changes after binding");
    let attempt = 0;
    const implement: StageFn = (spec) => {
      attempt += 1;
      writeTree(spec.cwd, { [`web/src/feature-t1-${String(attempt)}.txt`]: "done\n" });
      git(spec.cwd, "add", "-A");
      git(spec.cwd, "commit", "-q", "-m", `t1: attempt ${String(attempt)}`);
      return okResult();
    };
    const outcome = await run({ root: repo.root, backend: new MockBackend({ implement, review: reviewApprove }), prompts: PROMPTS, runId: "drift", ecosystems: [] });
    expect(outcome.exitCode).not.toBe(EXIT_OK);
    const ticket = readTicket(repo.root, "t1");
    expect(ticket.state).toBe("BLOCKED");
    expect(ticket.notes.map((n) => n.text).join("\n")).toContain("web:test");

    expect((await verifySync(repo.root, { consent: async () => true, now: NOW })).exitCode).toBe(EXIT_OK);
    const resumed = await run({ root: repo.root, backend: new MockBackend({ implement, review: reviewApprove }), prompts: PROMPTS, runId: "synced", ecosystems: [] });
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(repo.root, "t1").state).toBe("DONE");
  }, 60_000);
});

const binding = (pkg: string, slot: Binding["slot"], resolved: string, status: Binding["status"] = "approved"): Binding => ({
  schema_version: SCHEMA_VERSION,
  package: pkg,
  slot,
  adapter: "make",
  ref: slot,
  resolved,
  config_hash: "a".repeat(64),
  executed_at: NOW(),
  approved_by: "auto",
  status,
});

describe("V-5′ a ticket no gate can fail holds approval", () => {
  function presentRoot(): string {
    const root = tmpTree();
    scratch.push(root);
    mkdirSync(path.join(root, ".detent", "state"), { recursive: true });
    return root;
  }
  const ticket = (id: string, surface: readonly string[]) => newTicket({ id, type: "feature", title: `Ticket ${id}`, acceptance_criteria: ["it works"], surface });

  it("PRESENT names each path that lies in no package with a bound gate, and asks nothing until it is fixed", async () => {
    const root = presentRoot();
    let asked = 0;
    const outcome = await presentStage({
      root,
      tickets: [ticket("t1", ["web/src/**"]), ticket("t2", ["src/**"]), ticket("t3", ["admin/package.json", "admin/src/main.ts"])],
      bindings: [binding(".", "test", "make test"), binding("web", "build", "make build")],
      skips: [],
      packages: [".", "web"],
      bootstrap: null,
      assignments: {},
      ask: async () => {
        asked += 1;
        return { kind: "approved", by: "op" };
      },
    });
    expect(asked).toBe(0);
    expect(outcome.kind === "interrupt" ? outcome.interrupt : outcome.kind).toBe("AWAIT_INFO");
    expect(outcome.kind === "interrupt" ? outcome.items : []).toEqual([
      "t1: web/src/** lies in web, which has no gate a ticket runs (lint, typecheck or test)",
      "t3: admin/package.json makes admin a package, and no gate is bound for it",
    ]);
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("## Packages");
    const shown = JSON.parse(readFileSync(path.join(stateDir(root), "plan", "presentation.json"), "utf8")) as Record<string, unknown>;
    expect(shown["ungated"]).toBe(2);
  });

  it("a ticket already DONE, and one whose every path lies in a gated package, hold nothing", async () => {
    const root = presentRoot();
    const done = { ...ticket("t1", ["web/**"]), state: "DONE" as const };
    const outcome = await presentStage({
      root,
      tickets: [done, ticket("t2", ["src/**", "web/src/**", "web/package.json"])],
      bindings: [binding(".", "test", "make test"), binding("web", "lint", "make lint")],
      skips: [],
      packages: [".", "web", "web/legacy"],
      bootstrap: null,
      assignments: {},
    });
    expect(outcome.kind === "interrupt" ? outcome.interrupt : outcome.kind).toBe("AWAIT_APPROVAL");
  });

  it("`run` presents a plan with an ungated ticket and does not offer approval", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["admin/src/**", "admin/package.json"] }]);
    rmSync(path.join(stateDir(repo.root), "plan", "approval.json"), { force: true });
    const stored = readBindings(repo.root);
    await presentStage({ root: repo.root, tickets: allTickets(repo.root), bindings: stored.bindings, skips: stored.skips, packages: stored.packages, bootstrap: null, assignments: {} });
    let asked = 0;
    const outcome = await run({
      root: repo.root,
      backend: new MockBackend(),
      prompts: PROMPTS,
      runId: "ungated",
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "should-never-be-asked" };
      },
    });
    expect(asked).toBe(0);
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("no gate that can fail");
  }, 60_000);
});

describe("V-5′ `run` checks every package's toolchain", () => {
  it("names a missing toolchain a package's gate needs, by package, before anything spends", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const file = readBindings(repo.root);
    writeBindings(repo.root, { ...file, bindings: file.bindings.map((b) => (b.package === "web" ? { ...b, resolved: "go test ./..." } : b)) });
    const backend = new MockBackend();
    const said: string[] = [];
    const outcome = await run({ root: repo.root, backend, prompts: PROMPTS, runId: "toolchain", toolchainProbe: (exe) => exe !== "go", announce: (m) => said.push(m) });
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("missing toolchain: go");
    expect(said.join("\n"), "the gate that needs it, by its package").toContain("go — needed by web:test");
    expect(backend.calls).toHaveLength(0);
  }, 60_000);
});

describe("C-4 bootstrap promotes each package from what discovery finds in it", () => {
  it("matches a provisional binding to its own package's candidate, and stores the command a gate runs", () => {
    const provisional = (pkg: string, resolved: string): Binding => binding(pkg, "test", resolved, "provisional");
    let written: { bindings: readonly Binding[] } | null = null;
    const promoted = finalizeBootstrap("/unused", BOOTSTRAP_TICKET_ID, {
      readBindings: () => ({ bindings: [provisional(".", "npm test"), provisional("web", "pnpm test")], skips: [], packages: [".", "web"] }),
      writeBindings: (file) => {
        written = file;
      },
      rediscover: () => [
        {
          package: ".",
          ...candidate({ slot: "test", adapter: "node-scripts", ref: "test", resolved: "npm run test", pm: "npm", config_file: "package.json", config_region: "scripts.test=vitest", rank: 0 }),
        },
        {
          package: "web",
          ...candidate({ slot: "test", adapter: "make", ref: "test", resolved: "make test", pm: null, config_file: "Makefile", config_region: "test:\n\tsh gate.sh test", rank: 0 }),
        },
      ],
      now: NOW,
    });
    expect(promoted).toBe(true);
    const bindings = (written as { bindings: readonly Binding[] } | null)?.bindings ?? [];
    expect(bindings.map((b) => [b.package, b.slot, b.adapter, b.resolved, b.status])).toEqual([
      [".", "test", "node-scripts", "npm run test -- --run", "approved"],
      ["web", "test", "make", "make test", "approved"],
    ]);
  });

  it("stores what the gate runs, so a vitest-backed test the bootstrap promotes does not drift on the next ticket", () => {
    const root = tmpTree({ "package.json": '{"name":"app","private":true,"scripts":{"test":"vitest"}}\n' });
    scratch.push(root);
    gitInit(root);
    initLayout(root);
    writeBindings(root, { bindings: [binding(".", "test", "npm run test", "provisional")], skips: [] });
    const promoted = finalizeBootstrap(root, BOOTSTRAP_TICKET_ID, {
      readBindings: () => readBindings(root),
      writeBindings: (file) => writeBindings(root, file),
      rediscover: () => packageCandidates(root, [ROOT_PACKAGE]),
      now: NOW,
    });
    expect(promoted).toBe(true);
    /* Before PRDR-295: "stored `npm run test`, current `npm run test -- --run`", and every ticket after the bootstrap halted. */
    expect(checkAll(readBindings(root).bindings, discoverPackages(root, [ROOT_PACKAGE])).halting.map((h) => h.message)).toEqual([]);
  });
});
