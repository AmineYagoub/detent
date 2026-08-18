import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDossier, dossierSummary } from "../../src/kernel/dossier.js";
import { EXIT_HUMAN_GATED, EXIT_OK, run, type EscalationAction, type EscalationInput } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, implementRed, makeRunRepo, noopFix, researchValid, reviewApprove } from "./run-fixture.js";

/**
 * T-049 — escalation UX, dossier, and the B-4 risk gate. Two oracle ports:
 * test_risk_path_requires_human_approval (approve → re-verify → DONE) and
 * test_risk_detection_on_master_based_repo (globs work against any base name).
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(riskGlobs: string[] = []): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  if (riskGlobs.length > 0) {
    const configPath = path.join(root, ".detent/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { risk: string[] };
    config.risk = riskGlobs;
    writeTree(root, { ".detent/config.json": `${JSON.stringify(config, null, 2)}\n` });
  }
  return root;
}

/** Implements by touching an auth file — the risk surface. */
const implementAuth: StageFn = (spec) => {
  writeTree(spec.cwd, { "src/auth/login.py": "def login():\n    return True\n" });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: touch auth`);
  return okResult();
};

describe("T-049 B-4 risk gate (oracle test_risk_path_requires_human_approval)", () => {
  it("a diff touching risk globs requires a human; approve re-enters APPROVED, the kernel re-verifies, then DONE", async () => {
    const root = await fixture(["src/auth/**"]);
    addTicket(root, { id: "t1", surface: ["src/**"] });

    const decisions: EscalationInput[] = [];
    const escalate = async (input: EscalationInput): Promise<EscalationAction> => {
      decisions.push(input);
      return { kind: "approve", by: "reviewer-human" };
    };

    const backend = new MockBackend({ implement: implementAuth, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "risk", escalate });

    // Approved in-run (C-10): the loop continued in-process to DONE.
    expect(outcome.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toContain("risk-path change requires human approval");

    // The journal shows the whole B-4 shape: risk → NEEDS_HUMAN → approval →
    // APPROVED → re-verify (close-check gates) → DONE. Never a direct DONE.
    const journal = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    expect(journal).toContain("RISK_LABEL_REQUIRED");
    expect(journal).toContain("HUMAN_APPROVED");
    const lines = journal.trim().split("\n").map((l) => JSON.parse(l) as { event: string; to: string });
    const approvedAt = lines.findIndex((l) => l.event === "HUMAN_APPROVED");
    const doneAt = lines.findIndex((l) => l.to === "DONE");
    expect(approvedAt).toBeGreaterThanOrEqual(0);
    expect(doneAt).toBeGreaterThan(approvedAt);
    // the re-verify, not the approval
    expect(lines[doneAt]?.event).toBe("GATE_GREEN");
  });

  it("oracle test_risk_detection_on_master_based_repo: globs fire against a master-based repository", async () => {
    const root = await fixture(["src/auth/**"]);
    // Rename the base to master BEFORE the run creates its branch.
    git(root, "branch", "-q", "-m", "main", "master");
    addTicket(root, { id: "t1", surface: ["src/**"] });

    const backend = new MockBackend({ implement: implementAuth, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "master" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("src/auth/login.py");
    // base intact
    expect(git(root, "rev-parse", "master")).toBeTruthy();
  });

  it("the risk_label half still fires without any glob", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", risk_label: true });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "label" });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").notes.map((n) => n.text).join(" ")).toContain("risk-labelled");
  });
});

describe("T-049 C-10 escalation actions", () => {
  it("requeue-with-guidance opens a fresh generation carrying the guidance, and the loop continues in-process", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    let offered = 0;
    const escalate = async (): Promise<EscalationAction> => {
      offered += 1;
      return offered === 1
        ? { kind: "requeue", by: "operator", guidance: "the fix is in the seed row" }
        : { kind: "skip", by: "operator" };
    };

    // Generation 0 exhausts the ladder; generation 1's implement acts on the
    // guidance — it removes the failure gen 0 planted, then implements.
    const backend = new MockBackend({
      "implement:0": implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
      "implement:1": (spec) => {
        rmSync(path.join(spec.cwd, ".fail"), { force: true });
        return implementGreen(spec);
      },
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "requeue", escalate });

    expect(outcome.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(t1.generations).toHaveLength(2);
    expect(t1.generations[0]).toMatchObject({ outcome: "requeued" });
    expect(t1.generations[1]?.reason).toBe("the fix is in the seed row");
    // X-8: fresh counters in the new generation; the old record is frozen.
    expect(t1.generations[0]?.counters.blind_fix_attempts).toBe(1);
    expect(t1.generations[1]?.counters.blind_fix_attempts).toBe(0);
  });

  it("skip leaves the ticket pending and the run exits 10; quit stops the run", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });

    const actions: EscalationAction[] = [{ kind: "skip", by: "op" }, { kind: "quit" }];
    const escalate = async (): Promise<EscalationAction> => actions.shift() ?? { kind: "quit" };

    const failing = { implement: implementRed, blind_fix: noopFix, research: researchValid, informed_fix: noopFix };
    const backend = new MockBackend(failing);
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "skipquit", escalate });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").notes.map((n) => n.text).join(" ")).toContain("skipped at escalation");
    // quit fired during t2's escalation: the run stopped, both pending.
    expect(outcome.summary.pending.map((p) => p.id).sort()).toEqual(["t1", "t2"]);
  });
});

describe("T-049 A-8 dossier", () => {
  it("lists per-generation history and displays cumulative totals (X-8)", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    // Exhaust gen 0, requeue via escalation, exhaust gen 1, then skip.
    let offered = 0;
    const escalate = async (): Promise<EscalationAction> => {
      offered += 1;
      return offered === 1 ? { kind: "requeue", by: "op", guidance: "try again" } : { kind: "skip", by: "op" };
    };
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
    });
    await run({ root, backend, prompts: PROMPTS, runId: "dossier", escalate });

    const t1 = readTicket(root, "t1");
    expect(t1.generations).toHaveLength(2);
    const dossier = buildDossier(root, t1, "ladder exhausted twice");
    expect(dossier.generations).toHaveLength(2);
    expect(dossier.artifact_index).toContain("dossier.json");
    expect(dossier.artifact_index).toContain("last_failure.json");

    const summary = dossierSummary(t1, dossier);
    // Cumulative across generations (X-8): gen 0 is a full 4-session ladder;
    // gen 1 re-runs it with the research stage served from the D-18 cache —
    // the slot consumed, no session launched — so 3 sessions there.
    expect(summary).toContain("generations: 2");
    expect(summary).toContain("7 sessions");
    expect(summary).toContain("4 fixes");
    expect(summary).toContain("2 research");
    // The cache hit is visible in gen 1's counters: slot 1, and one fewer session.
    expect(t1.generations[1]?.counters.research_sessions).toBe(1);
    expect(t1.generations[1]?.counters.sessions).toBe(3);
  });
});
