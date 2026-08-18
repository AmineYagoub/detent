import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CI_ENV } from "../adapter/normalize.js";
import { runGate } from "../adapter/run.js";
import { parseArtifact } from "../schemas/common.js";
import { hypothesisSchema, type Hypothesis, type ResearchBrief } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import { Breach, publicTicket, type RefereeContext } from "./referee-context.js";
import type { SessionArm } from "./referee-session.js";
import type { KernelEvent } from "./events.js";
import { runsDir } from "./journal.js";
import { diagnoseStage } from "./stages/diagnose.js";
import { reviewStage } from "./stages/review.js";
import { researchStage } from "./stages/research.js";
import { readTicket } from "./tickets/readers.js";
import { appendNote, linkDiscovered } from "./tickets/mutations.js";

/**
 * T-102's validator-backed stages (T-043/T-044/T-045): diagnose, review, and
 * research launch their sessions HERE, beside the validator that justifies
 * their event — which is why they are `record` moves, not `attempt` moves. A
 * review breaker surfaces as a `Breach` for the driver's breach path; the
 * returned event reaches `apply` only through the core's escrow.
 */
export async function runRefereeStage(
  kind: "diagnose" | "review" | "research",
  id: string,
  ctx: RefereeContext,
  sessions: SessionArm,
): Promise<KernelEvent> {
  const ticket = readTicket(ctx.root, id);
  const workDir = ctx.workDirFor(id);
  if (kind === "diagnose") return await diagnose(ticket, ctx, sessions, workDir);
  if (kind === "review") return await review(ticket, ctx, sessions, workDir);
  return await research(ticket, ctx, sessions, workDir);
}

async function diagnose(ticket: Ticket, ctx: RefereeContext, sessions: SessionArm, workDir: string): Promise<KernelEvent> {
  const id = ticket.id;
  const artifactPath = path.join(runsDir(ctx.root, id), "hypothesis.json");
  const outcome = await diagnoseStage({
    launch: async () => {
      await sessions.launch(ticket, "DIAGNOSED", { ticket: publicTicket(ticket) }, workDir);
    },
    readArtifact: () => ctx.maybeArtifact(id, "hypothesis.json"),
    writeArtifact: (h: Hypothesis) => {
      mkdirSync(path.dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, `${JSON.stringify(h, null, 2)}\n`);
    },
    executeRepro: (command) =>
      runGate({ command, cwd: workDir, slot: "test", timeoutMs: ctx.budgets.gate_timeout_ms, env: CI_ENV }),
    note: (text) => appendNote(ctx.root, id, { author: "kernel", text }),
  });
  return outcome.event;
}

async function review(ticket: Ticket, ctx: RefereeContext, sessions: SessionArm, workDir: string): Promise<KernelEvent> {
  const id = ticket.id;
  const hypothesisRaw = ctx.maybeArtifact(id, "hypothesis.json");
  const hypothesisParsed = hypothesisRaw === null ? null : parseArtifact(hypothesisSchema, hypothesisRaw);
  const hypothesis = hypothesisParsed !== null && hypothesisParsed.ok ? hypothesisParsed.value : null;
  const outcome = await reviewStage(ticket, ctx.diff(workDir), hypothesis, {
    launch: async (inputs) => {
      await sessions.launch(ticket, "IN_REVIEW", inputs, workDir);
    },
    readArtifact: () => ctx.maybeArtifact(id, "review.json"),
    note: (text) => appendNote(ctx.root, id, { author: "kernel", text }),
  });
  if (outcome.kind === "breaker") throw new Breach(outcome.reason);
  return outcome.event;
}

async function research(ticket: Ticket, ctx: RefereeContext, sessions: SessionArm, workDir: string): Promise<KernelEvent> {
  const id = ticket.id;
  const outcome = await researchStage({
    root: ctx.root,
    launch: async (inputs) => {
      await sessions.launch(ticket, "RESEARCH", inputs, workDir);
    },
    readArtifact: () => ctx.maybeArtifact(id, "research.json"),
    readFailureSignature: () => {
      const failure = ctx.maybeArtifact(id, "last_failure.json") as { signature?: string } | null;
      return failure?.signature ?? null;
    },
    toolCallCeiling: ctx.budgets.failure_research_tool_calls,
    note: (text) => appendNote(ctx.root, id, { author: "kernel", text }),
    ticketInputs: {
      ticket: publicTicket(ticket),
      failure: ctx.maybeArtifact(id, "last_failure.json"),
    },
  });
  if (outcome.upstream !== undefined) {
    linkUpstream(ticket, outcome.upstream, ctx);
  }
  return outcome.event;
}

function linkUpstream(ticket: Ticket, brief: ResearchBrief, ctx: RefereeContext): void {
  const source = brief.evidence[0]?.source ?? "unknown";
  linkDiscovered(
    ctx.root,
    ticket.id,
    {
      id: `${ticket.id}-upstream`,
      type: "bug",
      title: `Upstream bug blocking ${ticket.id}`,
      description: `See ${source}. ${brief.upstream_bug ?? ""}`,
      acceptance_criteria: ["upstream fix released, or an approved workaround chosen"],
    },
    "related",
  );
}
