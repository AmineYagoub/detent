import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvedHashes, isApproved, approvalsPath, recordApprovals } from "../../src/adapter/approvals.js";
import { checkAll, readBindings, writeBindings } from "../../src/adapter/drift.js";
import { discoverPackages, gateLabel } from "../../src/adapter/packages.js";
import { doctor } from "../../src/cli/doctor.js";
import { acceptTicketDrift, verifySync } from "../../src/cli/verify.js";
import { bindingTable } from "../../src/init/bind.js";
import { declaredBinding } from "../../src/init/bind-declared.js";
import { BOOTSTRAP_TICKET_ID } from "../../src/init/plan-write.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { discoverAtCommit, readAcceptedDrift } from "../../src/kernel/drift-base.js";
import { boundTestRunner } from "../../src/kernel/falsify.js";
import { ensureRunBranch } from "../../src/kernel/git.js";
import { EXIT_HUMAN_GATED, EXIT_NOT_READY, EXIT_OK, run } from "../../src/kernel/run.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { SCHEMA_VERSION, STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import type { Binding } from "../../src/schemas/records.js";
import { guardToolUse } from "../../src/sessions/guard.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { git, writeTree } from "../helpers.js";
import { GATE, NOW, dropScratch, implementIn, lines, planned, ran, scratch, twoPackages } from "../init/packages-fixture.js";
import { BUDGETS, PROMPTS } from "../init/plan-fixture.js";
import { addTicket, approveFixturePlan, makeRunRepo, noopFix, researchValid, reviewApprove } from "./run-fixture.js";

/**
 * V-5′ (PRDR-295) — every path that reads or judges a gate reads it per package.
 *
 * `tests/init/bind-packages.test.ts` binds packages and runs a ticket's gates
 * in them. These are the other readers of a binding: the sync that re-binds
 * after drift, the per-ticket acceptance under worktrees, the falsification
 * probe, the session's preamble, the approvals ledger, the fork's discovery,
 * the flake rerun, the containment guard, and the checkpoint that re-binds.
 */

afterEach(dropScratch);

const at = (file: string, pkg: string, slot: Binding["slot"]): Binding | undefined => readBindings(file).bindings.find((b) => b.package === pkg && b.slot === slot);

describe("V-5′ `verify sync` re-binds every package", () => {
  it("names the package whose gate drifted, re-baselines it with the rest, and keeps what the pack declared where nothing on disk binds it", async () => {
    const repo = twoPackages({ "site/package.json": '{"name":"site"}\n' });
    await planned(repo, []);
    const file = readBindings(repo.root);
    writeBindings(repo.root, { ...file, packages: [...file.packages, "admin"], bindings: [...file.bindings, declaredBinding("admin", "test", "npm test", NOW())] });
    const before = at(repo.root, "web", "test")?.config_hash;
    writeTree(repo.root, { "web/Makefile": ".PHONY: test\n\ntest:\n\tsh gate.sh test && echo extended\n" });

    let drifted: string[] = [];
    const synced = await verifySync(repo.root, {
      consent: async (summary) => {
        drifted = summary.drift.filter((d) => d.status === "drifted").map((d) => gateLabel(d));
        return true;
      },
      now: NOW,
    });
    expect(synced.exitCode, synced.messages.join(" | ")).toBe(EXIT_OK);
    expect(drifted).toEqual(["web:test"]);
    const after = readBindings(repo.root);
    expect(after.packages).toEqual([".", "admin", "site", "web"]);
    expect(at(repo.root, "web", "test")?.config_hash).not.toBe(before);
    expect(after.bindings.filter((b) => b.package === "admin").map((b) => [b.slot, b.resolved, b.adapter])).toEqual([["test", "npm test", "declared"]]);
    expect(after.skips.map((s) => gateLabel(s)), "each package keeps its own acknowledged gaps, and a package with no gate has none").toEqual(file.skips.map((s) => gateLabel(s)));
    expect(checkAll(after.bindings, discoverPackages(repo.root, after.packages)).halting).toEqual([]);
  }, 60_000);

  it("refuses while a package's candidates wait on a choice, naming the package", async () => {
    const repo = twoPackages();
    await planned(repo, []);
    writeTree(repo.root, { "web/package.json": '{"name":"web","private":true,"scripts":{"test":"sh gate.sh test"}}\n' });
    let asked = 0;
    const synced = await verifySync(repo.root, {
      consent: async () => {
        asked += 1;
        return true;
      },
    });
    expect(synced.exitCode).toBe(EXIT_NOT_READY);
    expect(asked).toBe(0);
    expect(synced.messages.join("\n")).toContain("web:test: 2 plausible candidates");
  }, 60_000);
});

/** A granted verification change: the ticket extends web's test recipe. */
const changeWebGate: StageFn = (spec) => {
  const makefile = readFileSync(path.join(spec.cwd, "web/Makefile"), "utf8");
  writeTree(spec.cwd, { "web/Makefile": makefile.replace("sh gate.sh test", "sh gate.sh test # extended by t1"), "web/src/feature-t1.txt": "done\n" });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", "t1: extend web's test");
  return okResult();
};

const buildOn: StageFn = (spec) => {
  writeTree(spec.cwd, { [`web/src/again-${spec.ticketId}.txt`]: "again\n" });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: build on the inherited tree`);
  return okResult();
};

describe("V-5′ a ticket's change to a package's gate is judged and accepted by package", () => {
  it("halts naming the package, accepts it keyed by the package, and the rerun finishes the ticket and moves the root's baseline for that package alone", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["web/src/**", "web/Makefile"] }]);
    const rootTest = at(repo.root, ".", "test")?.config_hash;
    const webTest = at(repo.root, "web", "test")?.config_hash;
    const halted = await run({ root: repo.root, backend: new MockBackend({ implement: changeWebGate, review: reviewApprove }), prompts: PROMPTS, runId: "halt", worktree: true, ecosystems: [] });
    expect(halted.exitCode).toBe(EXIT_NOT_READY);
    expect(readTicket(repo.root, "t1").state).toBe("BLOCKED");
    expect(readTicket(repo.root, "t1").notes.map((n) => n.text).join("\n")).toContain("web:test");

    const accepted = await acceptTicketDrift(repo.root, "t1", { consent: async () => true, user: "operator" });
    expect(accepted.exitCode, accepted.messages.join(" | ")).toBe(EXIT_OK);
    expect(Object.keys(readAcceptedDrift(repo.root, "t1")?.hashes ?? {})).toEqual(["web:test"]);

    const resumed = await run({ root: repo.root, backend: new MockBackend({ implement: buildOn, review: reviewApprove }), prompts: PROMPTS, runId: "resume", worktree: true, ecosystems: [] });
    expect(resumed.exitCode, resumed.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(repo.root, "t1").state).toBe("DONE");
    expect(at(repo.root, "web", "test")?.config_hash, "web's baseline followed the merge").not.toBe(webTest);
    expect(at(repo.root, ".", "test")?.config_hash, "the root's did not move").toBe(rootTest);
  }, 120_000);
});

describe("V-5′ the falsification probe runs each test with its own package's gate", () => {
  it("runs the gate of each package a changed test lies in, in that package's directory, and passes only if all of them pass", async () => {
    const repo = twoPackages();
    await planned(repo, []);
    const probe = boundTestRunner(repo.root, "HEAD", 30_000);
    const real = realpathSync(repo.root);

    expect(await probe(repo.root, ["web/src/index.test.ts"])).toBe(true);
    expect(lines(repo.log)).toEqual([`web test ${path.join(real, "web")}`]);

    writeTree(repo.root, { "web/.fail": "web is red\n" });
    expect(await probe(repo.root, ["tests/test_app.py", "web/src/index.test.ts"]), "one package red is the probe red").toBe(false);
    expect(ran(repo.log)).toEqual(new Set(["web test", "root test"]));
  }, 60_000);

  it("a changed test in a package with no test gate answers false, as the root with none always has", async () => {
    const repo = twoPackages({ "admin/package.json": '{"name":"admin"}\n' });
    await planned(repo, []);
    expect(await boundTestRunner(repo.root, "HEAD", 30_000)(repo.root, ["admin/src/a.test.ts"])).toBe(false);
    expect(lines(repo.log)).toEqual([]);
  }, 60_000);
});

describe("V-5′ every session is told each package's gates", () => {
  it("keeps the root's gates by slot, as before packages, and gives each other package's under its path", async () => {
    const repo = twoPackages({ "web/package.json": '{"name":"web","private":true,"scripts":{"test":"sh gate.sh test"}}\n' });
    git(repo.root, "rm", "-q", "web/Makefile");
    git(repo.root, "commit", "-q", "-m", "web's test is its package.json's");
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const backend = new MockBackend({ implement: implementIn({ t1: ["web/src"] }), review: reviewApprove });
    await run({ root: repo.root, backend, prompts: PROMPTS, runId: "preamble", ecosystems: [] });
    const prefix = backend.calls[0]?.spec.promptPrefix ?? "";
    const preamble = JSON.parse(prefix.split("== VERIFICATION BINDINGS ==\n")[1] ?? "{}") as Record<string, unknown>;
    expect(preamble["bindings"]).toEqual({ test: "make test", lint: "make lint" });
    expect(preamble["packages"]).toEqual({ web: { test: "npm run test" } });
  }, 60_000);
});

const row = (pkg: string): Binding => ({
  schema_version: SCHEMA_VERSION,
  package: pkg,
  slot: "test",
  adapter: "make",
  ref: "test",
  resolved: "make test",
  config_hash: "b".repeat(64),
  executed_at: NOW(),
  approved_by: "auto",
  status: "approved",
});

describe("V-5′ an approval is admissible in its own package only", () => {
  it("does not admit one package's approved gate text in another, and reads a row written before packages as the root's", () => {
    const repo = twoPackages();
    recordApprovals(repo.root, [row("web")], NOW());
    const approved = approvedHashes(repo.root);
    expect(isApproved(approved, row("web"), "b".repeat(64))).toBe(true);
    expect(isApproved(approved, row("."), "b".repeat(64)), "the same Makefile text, in another package").toBe(false);

    const older = { schema_version: SCHEMA_VERSION, at: NOW(), slot: "test", adapter: "make", ref: "test", resolved: "make test", config_hash: "c".repeat(64), approved_by: "auto" };
    appendFileSync(approvalsPath(repo.root), `${JSON.stringify(older)}\n`);
    expect(isApproved(approvedHashes(repo.root), row("."), "c".repeat(64))).toBe(true);
    expect(isApproved(approvedHashes(repo.root), row("web"), "c".repeat(64))).toBe(false);
  });
});

describe("V-5′ the fork's configuration is read per package", () => {
  it("discovers each package's candidates at a commit from that package's own marker files", () => {
    const repo = twoPackages();
    const head = git(repo.root, "rev-parse", "HEAD").trim();
    writeTree(repo.root, { "web/Makefile": ".PHONY: test\n\ntest:\n\tsh gate.sh test && echo later\n" });
    git(repo.root, "commit", "-q", "-am", "web's test changes after the fork");

    const fork = discoverAtCommit(repo.root, head, [".", "web"]);
    const now = discoverPackages(repo.root, [".", "web"]);
    const hash = (found: typeof now | null, pkg: string): string | undefined => found?.get(pkg)?.candidates.find((c) => c.slot === "test")?.config_hash;
    expect([...(fork?.keys() ?? [])]).toEqual([".", "web"]);
    expect(hash(fork, "web")).toBeDefined();
    expect(hash(fork, "web"), "the fork's web Makefile, not today's").not.toBe(hash(now, "web"));
    expect(hash(fork, "."), "the root's is unchanged").toBe(hash(now, "."));
  });
});

describe("V-5′ a suspected flake is rerun where its package's gates run", () => {
  it("reruns the failing package's own test_single in that package's directory, and quarantines on green", async () => {
    const repo = twoPackages({ "web/Makefile": ".PHONY: test test-single\n\ntest:\n\tsh gate.sh test\n\ntest-single:\n\tsh single.sh\n" });
    /** The flake: web's test fails once, on what `.fail` says. The isolated rerun logs where it ran, and passes. */
    writeTree(repo.root, {
      "web/gate.sh": GATE("web", repo.log).replace("cat .fail; exit 1", "cat .fail; rm .fail; exit 1"),
      "web/single.sh": `#!/bin/sh\necho "web test_single $(pwd -P)" >> '${repo.log}'\nexit 0\n`,
    });
    git(repo.root, "add", "web/gate.sh", "web/single.sh");
    git(repo.root, "commit", "-q", "-m", "web's isolated test");
    await planned(repo, [{ id: "t1", surface: ["web/src/**"] }]);
    const flaky: StageFn = (spec) => {
      writeTree(spec.cwd, { "web/.fail": "a flaky test timed out\n", "web/src/feature-t1.txt": "done\n" });
      git(spec.cwd, "add", "web/src");
      git(spec.cwd, "commit", "-q", "-m", "t1: implement");
      return okResult();
    };
    const outcome = await run({ root: repo.root, backend: new MockBackend({ implement: flaky, review: reviewApprove }), prompts: PROMPTS, runId: "flake", ecosystems: [], maxTickets: 1 });
    expect(outcome.exitCode, outcome.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(repo.root, "t1").state).toBe("DONE");
    const real = realpathSync(repo.root);
    expect(lines(repo.log).slice(0, 2)).toEqual([`web test ${path.join(real, "web")}`, `web test_single ${path.join(real, "web")}`]);
    expect(allTickets(repo.root).map((t) => t.id)).toContain("t1-flake-1");
  }, 60_000);
});

describe("V-5′ a ticket whose packages bind no gate is never judged green", () => {
  it("refuses to judge a ticket writing a package with no gate, naming it, and a gated package beside it does not stand in for it", async () => {
    const repo = twoPackages({ "admin/package.json": '{"name":"admin"}\n' });
    await planned(repo, [{ id: "t1", surface: ["src/**", "admin/src/**"] }]);
    const backend = new MockBackend({ implement: implementIn({ t1: ["src", "admin/src"] }), review: reviewApprove });
    const outcome = await run({ root: repo.root, backend, prompts: PROMPTS, runId: "gateless", ecosystems: [] });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const ticket = readTicket(repo.root, "t1");
    expect(ticket.state).toBe("NEEDS_HUMAN");
    expect(ticket.notes.map((n) => n.text).join("\n")).toContain("no gate is bound for lint, typecheck, test in admin, the package its surface touches (V-5′) — nothing would be verified");
    expect(lines(repo.log), "the root's gates, which would pass, never ran for it").toEqual([]);
  }, 60_000);
});

describe("V-5′ the first red gate holds a ticket, in whichever package it runs", () => {
  it("stops at the root's red gate, and a green package after it does not pass the ticket", async () => {
    const repo = twoPackages();
    await planned(repo, [{ id: "t1", surface: ["src/**", "web/src/**"] }]);
    const redRoot: StageFn = (spec) => {
      writeTree(spec.cwd, { ".fail": "the root is red\n", "src/feature-t1.txt": "attempt\n", "web/src/feature-t1.txt": "attempt\n" });
      git(spec.cwd, "add", "src", "web/src");
      git(spec.cwd, "commit", "-q", "-m", "t1: attempt");
      return okResult();
    };
    const backend = new MockBackend({ implement: redRoot, blind_fix: noopFix, research: researchValid, informed_fix: noopFix, review: reviewApprove });
    await run({ root: repo.root, backend, prompts: PROMPTS, runId: "red-root", ecosystems: [] });
    expect(readTicket(repo.root, "t1").state).not.toBe("DONE");
    expect(ran(repo.log).has("root lint")).toBe(true);
    expect(ran(repo.log).has("web test"), "web's gate never ran after the root's red").toBe(false);
    expect(JSON.parse(readFileSync(path.join(repo.root, ".detent/runs/t1/last_failure.json"), "utf8"))).not.toHaveProperty("package");
  }, 60_000);
});

describe("C-4 the bootstrap proves and promotes every package it scaffolds", () => {
  it("runs the bootstrap's gates in each declared package, and promotes each binding from what discovery finds in its own package", async () => {
    const { root } = await makeRunRepo();
    scratch.push(root);
    git(root, "rm", "-q", "-r", "Makefile", "scripts");
    git(root, "commit", "-q", "-m", "greenfield: the documents and nothing else");
    writeBindings(root, {
      packages: [".", "web"],
      bindings: [{ ...declaredBinding(".", "test", "npm run test", NOW()), adapter: "greenfield:typescript" }, declaredBinding("web", "test", "npm run test", NOW())],
      skips: [],
    });
    addTicket(root, { id: BOOTSTRAP_TICKET_ID, surface: ["**"] });
    const manifest = (name: string): string => `${JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } })}\n`;
    const scaffold: StageFn = (spec) => {
      writeTree(spec.cwd, { "package.json": manifest("app"), "web/package.json": manifest("web") });
      git(spec.cwd, "add", "-A");
      git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: scaffold`);
      return okResult();
    };
    const outcome = await run({ root, backend: new MockBackend({ implement: scaffold, review: reviewApprove }), prompts: PROMPTS, runId: "bootstrap", worktree: true, ecosystems: [] });
    expect(outcome.exitCode, outcome.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, BOOTSTRAP_TICKET_ID).state).toBe("DONE");
    expect(readBindings(root).bindings.map((b) => `${gateLabel(b)} ${b.status}:${b.adapter}`)).toEqual(["test approved:node-scripts", "web:test approved:node-scripts"]);
    const notes = readTicket(root, BOOTSTRAP_TICKET_ID).notes.map((n) => n.text).join("\n");
    expect(notes, "both promoted when the bootstrap finished, from its own tree").toContain("2 provisional binding(s) finalized");
    expect(notes, "not left for the late promotion at the next pool").not.toContain("late (PRDR-218)");
  }, 60_000);
});

describe("C-4 a bootstrap already DONE is promoted late, per package (PRDR-218)", () => {
  it("promotes each package's provisional binding from what the merged tree holds in that package", async () => {
    const { root } = await makeRunRepo();
    scratch.push(root);
    git(root, "rm", "-q", "-r", "Makefile", "scripts");
    git(root, "commit", "-q", "-m", "greenfield: the documents and nothing else");
    writeBindings(root, {
      packages: [".", "web"],
      bindings: [{ ...declaredBinding(".", "test", "npm run test", NOW()), adapter: "greenfield:typescript" }, declaredBinding("web", "test", "npm run test", NOW())],
      skips: [],
    });
    addTicket(root, { id: BOOTSTRAP_TICKET_ID, surface: ["**"] });
    ensureRunBranch(root, "late");
    const manifest = (name: string): string => `${JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } })}\n`;
    writeTree(root, { "package.json": manifest("app"), "web/package.json": manifest("web") });
    git(root, "add", "package.json", "web/package.json");
    git(root, "commit", "-q", "-m", "merge t-001-bootstrap");
    const ticket = readTicket(root, BOOTSTRAP_TICKET_ID);
    const [generation] = ticket.generations;
    writeTicket(root, { ...ticket, state: "DONE", generations: [{ ...generation!, outcome: "done", ended_at: NOW() }] });
    approveFixturePlan(root);

    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, runId: "late", worktree: true, ecosystems: [] });
    expect(outcome.exitCode, outcome.summary.reason ?? "").toBe(EXIT_OK);
    expect(readBindings(root).bindings.map((b) => `${gateLabel(b)} ${b.status}:${b.adapter}`)).toEqual(["test approved:node-scripts", "web:test approved:node-scripts"]);
  }, 60_000);
});

describe("V-5′ `doctor` names each package's gates", () => {
  it("names a gate whose toolchain does not run by its package", async () => {
    const repo = twoPackages();
    await planned(repo, []);
    const file = readBindings(repo.root);
    writeBindings(repo.root, { ...file, bindings: file.bindings.map((b) => (b.package === "web" ? { ...b, resolved: "go test ./..." } : b)) });
    const report = await doctor(repo.root, { installedSdkVersion: () => "0.3.280", toolchainProbe: (exe) => exe !== "go" });
    expect(report.checks.find((c) => c.name === "toolchain")?.detail).toContain("`go` (web:test)");
  });
});

describe("V-5′ a session may not write a package's installed dependencies", () => {
  it("denies a write under any package's node_modules, which the referee installs and the gate runs", () => {
    const repo = twoPackages();
    mkdirSync(path.join(repo.root, "web", "node_modules"), { recursive: true });
    const decide = (rel: string): string => guardToolUse("Write", { file_path: path.join(repo.root, rel) }, { surface: ["**"], protectedGlobs: [...STRUCTURAL_PROTECTED], workRoot: repo.root }).decision;
    expect(decide("web/node_modules/dep/index.js")).toBe("deny");
    expect(decide("node_modules/dep/index.js")).toBe("deny");
    expect(decide("web/src/index.ts"), "the control: the package's own source").toBe("allow");
  });
});

describe("V-5′ DETERMINE_VERIFICATION's checkpoint reads each package's markers", () => {
  const digest = (root: string): string =>
    buildPipeline({ root, backend: new MockBackend({}), prompts: PROMPTS, budgets: BUDGETS })
      .find((h) => h.phase === "DETERMINE_VERIFICATION")
      ?.digest({ root, outputs: {}, now: () => 0 }) ?? "";

  it("re-binds when a package's own marker changes, and not when its source does", () => {
    const repo = twoPackages();
    const first = digest(repo.root);
    writeTree(repo.root, { "web/src/index.ts": "export const x = 2;\n" });
    expect(digest(repo.root), "source is not a marker").toBe(first);
    writeTree(repo.root, { "web/Makefile": ".PHONY: test\n\ntest:\n\tsh gate.sh test && echo again\n" });
    expect(digest(repo.root)).not.toBe(first);
  });
});

describe("V-5′ the binding table shows each package's gates", () => {
  it("labels a package's rows with its path, and says where a package has none", () => {
    const table = bindingTable([row("."), row("web")], [{ package: "web", slot: "lint", acknowledged_by: "op", at: NOW() }], [".", "admin", "web"]);
    expect(table).toMatch(/^ {2}test +make test/mu);
    expect(table).toMatch(/^ {2}web:test +make test/mu);
    expect(table).toMatch(/^ {2}web:lint +\(skipped\)/mu);
    expect(table).toMatch(/^ {2}admin +\(no gates: a ticket writing here cannot be approved\)/mu);
  });
});
