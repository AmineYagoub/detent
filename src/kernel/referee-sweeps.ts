import { existsSync } from "node:fs";
import { discover } from "../adapter/discover/index.js";
import { assertNoDrift, readBindings, writeBindings } from "../adapter/drift.js";
import { finalizeBootstrap } from "../init/plan.js";
import { BOOTSTRAP_TICKET_ID } from "../init/plan-write.js";
import type { Binding } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import type { KernelEvent } from "./events.js";
import { humanRequeue, outageRequeue } from "./events.js";
import { FALSIFIED_NOTE } from "./dependency.js";
import { currentGeneration, openGeneration } from "./generations.js";
import { worktreePath } from "./git.js";
import { lastNote, type RefereeContext } from "./referee-context.js";
import { allTickets } from "./tickets/readers.js";
import { appendNote, writeTicket } from "./tickets/mutations.js";

/**
 * The pool's sweeps: kernel-initiated re-queues that need no human because
 * the reason is already on the record. Each takes the core's ONE apply site
 * as `commit` — the sweep decides nothing about legality; the machine does.
 */

export type Commit = (ticket: Ticket, event: KernelEvent) => Ticket;

/**
 * V-3: after `verify sync` re-baselines the ROOT, a drift-blocked ticket
 * returns to the pool. V-3‴ (PRDR-226): a ticket blocked for ITS OWN tree's
 * change — its note names the `--ticket` verb — is not the root's to requeue;
 * `verify sync --ticket` accepts and requeues it, and a root-level sync would
 * only send it back into the same halt.
 */
export function requeueDriftBlocked(root: string, commit: Commit, at: string): void {
  const bindings = readBindings(root).bindings;
  if (bindings.length === 0) return;
  try {
    assertNoDrift(bindings, discover(root));
  } catch {
    return;
  }
  for (const ticket of allTickets(root)) {
    if (ticket.state !== "BLOCKED" || !lastNote(ticket).startsWith("drift-blocked:")) continue;
    if (lastNote(ticket).includes("--ticket")) continue;
    const requeued = commit(ticket, humanRequeue("verify-sync-rebaseline"));
    const generations = openGeneration(requeued, { at, reason: `gate drift re-baselined via verify sync; ${lastNote(ticket)}` });
    writeTicket(root, { ...requeued, generations });
    appendNote(root, ticket.id, { author: "kernel", text: "requeued after drift re-baseline (V-3/X-8)" });
  }
}

/**
 * PRDR-112: a ticket the outage pushed into NEEDS_HUMAN — its generation
 * closed on a $0 crash inside the streak, and the outage note is the last
 * word on it — returns to the pool with the reason recorded. A ticket a
 * person has since touched (any later note) is left to that person.
 */
export function requeueOutageVictims(root: string, commit: Commit, at: string): void {
  for (const ticket of allTickets(root)) {
    if (ticket.state !== "NEEDS_HUMAN") continue;
    const note = lastNote(ticket);
    if (!note.startsWith("outage:")) continue;
    const requeued = commit(ticket, outageRequeue(note));
    const generations = openGeneration(requeued, { at, reason: `requeued after a backend outage; ${note}` });
    writeTicket(root, { ...requeued, generations });
    appendNote(root, ticket.id, { author: "kernel", text: "requeued after outage (PRDR-112): not a finding against the ticket" });
  }
}

/** PRDR-277: the tickets a yes to a toolchain install returns, and what it installed. */
export interface ToolchainResume {
  readonly ids: readonly string[];
  /** `go (brew install go)` — the consent the requeue records, and the reason its generation opens with. */
  readonly installed: string;
}

/**
 * PRDR-277: what `run` hands the referee beyond `CoreOptions` — set only once
 * an approved install resolved, and absent on the plugin path, which asks no
 * such question.
 */
export interface ResumeOptions {
  readonly resumeOnInstall?: ToolchainResume;
}

/**
 * PRDR-277: stopped on a premise its session found false (X-4), and nobody
 * has touched it since — the kernel's falsification note is still its last
 * word. PRDR-112's selection, for X-4's own signal: a ticket a person has
 * noted since is that person's. X-4′'s unresolved dependency is not this: its
 * last word is the dependency note, and an install builds no missing code.
 */
function strandedOnPremise(ticket: Ticket): boolean {
  return ticket.state === "NEEDS_HUMAN" && lastNote(ticket).startsWith(FALSIFIED_NOTE);
}

/** PRDR-277: what `run` names before it asks — each ticket, and the premise in its session's words. */
export function strandedByPremise(root: string): { readonly id: string; readonly reason: string }[] {
  return allTickets(root)
    .filter(strandedOnPremise)
    .map((t) => ({ id: t.id, reason: lastNote(t).slice(FALSIFIED_NOTE.length) }));
}

/**
 * PRDR-277: the tickets the operator's yes to a toolchain install returned.
 *
 * X-4 sends a false premise to a human because only a human can change what
 * the ticket was written against. Installing a missing toolchain changes the
 * machine it runs on, on a human's answer — and the question that answer
 * replied to named each of these tickets. So the requeue is that human act,
 * recorded as its consent, as V-3's sweep records `verify sync`. Only the
 * tickets the question named, and only while they are still stranded: one a
 * person touched after the question was shown is left alone.
 */
export function requeueOnInstall(root: string, commit: Commit, at: string, resume: ToolchainResume): string[] {
  const returned: string[] = [];
  for (const ticket of allTickets(root)) {
    if (!resume.ids.includes(ticket.id) || !strandedOnPremise(ticket)) continue;
    const note = lastNote(ticket);
    const requeued = commit(ticket, humanRequeue(`toolchain install approved at run start: ${resume.installed}`));
    const generations = openGeneration(requeued, { at, reason: `${resume.installed} installed on the operator's approval; ${note}` });
    writeTicket(root, { ...requeued, generations });
    appendNote(root, ticket.id, {
      author: "kernel",
      text: `requeued: ${resume.installed} installed on the operator's approval, so a fresh attempt re-tests the premise the last one found false (PRDR-277)`,
    });
    returned.push(ticket.id);
  }
  return returned;
}

/**
 * PRDR-277: the install's yes, spent once. The pool calls the result at every
 * draw; the first call requeues, before the ready set is read, so that same
 * draw hands the ticket out — read after it, the pool is empty when the
 * returned ticket is all there is (ksar's case), and the run finishes clean
 * with its work READY and unclaimed. Each returned ticket is said out loud.
 */
export function resumeOnce(
  root: string,
  resume: ToolchainResume | undefined,
  announce?: (text: string) => void,
): (commit: Commit, at: string) => void {
  let pending = resume;
  return (commit, at) => {
    if (pending === undefined) return;
    const spent = pending;
    pending = undefined;
    for (const id of requeueOnInstall(root, commit, at, spent)) {
      announce?.(`${id} is back in the queue: ${spent.installed} is installed (PRDR-277)`);
    }
  };
}

/**
 * PRDR-217: a DONE ticket whose finalize did not complete.
 *
 * `finalizeDone` runs after the DONE transition: stage, commit, merge the
 * worktree into the run branch, remove it. B-2′ routes a merge CONFLICT to a
 * human; any other throw in it — gate-313: PRDR-216's `git add` — escaped as
 * exit 1 with the ticket DONE, its generation `in_flight`, its branch intact
 * and its work absent from the run branch, and nothing here looked at a DONE
 * ticket again. The next run's tickets then built on a run branch without the
 * bootstrap's scaffold. D-30: resume is a referee property.
 *
 * The signal is exact: DONE with the last generation still in flight. A
 * worktree still standing is finalized — the same `finalizeDone`, idempotent
 * for a clean tree and for the bootstrap's bindings — then the generation
 * closes as done, with a note and a journal event saying the finalize was
 * resumed. A conflict during that finalize closes the generation (so the
 * next resume leaves the ticket to its human, exactly B-2′'s state) and the
 * breach stands. No worktree and in flight is a crash between the merge and
 * the close: the work landed, only the record is open, so it closes. A closed
 * generation with a surviving worktree is a human's and is not touched.
 */
export function finalizeStranded(
  root: string,
  ctx: Pick<RefereeContext, "worktree" | "setWorkDir" | "clearWorkDir" | "iso" | "journal">,
  finalize: (id: string) => void,
  close: (id: string) => void,
): string[] {
  if (!ctx.worktree) return [];
  const resumed: string[] = [];
  for (const ticket of allTickets(root)) {
    if (ticket.state !== "DONE" || currentGeneration(ticket).outcome !== "in_flight") continue;
    const wt = worktreePath(root, ticket.id);
    if (existsSync(wt)) {
      ctx.setWorkDir(ticket.id, wt);
      try {
        finalize(ticket.id);
      } catch (err) {
        close(ticket.id);
        throw err;
      } finally {
        ctx.clearWorkDir(ticket.id);
      }
      appendNote(root, ticket.id, {
        author: "kernel",
        text: "finalize resumed: the run that reached DONE ended before this work was merged (PRDR-217)",
      });
      ctx.journal.appendTicketEvent(ticket.id, { event: "finalize", at: ctx.iso(), resumed: true });
    }
    close(ticket.id);
    resumed.push(ticket.id);
  }
  return resumed;
}

/**
 * C-4's finalize, with rediscovery run WHERE THE GATES RAN (PRDR-218).
 *
 * `finalizeDone` rediscovered on the root, before the merge — and under B-2″'s
 * default worktrees the scaffold bootstrap #1 created is not on the root yet.
 * gate-313 noted, twice, "test, lint, typecheck, build stayed provisional —
 * nothing discoverable backs them", and V-3 was exempt for the whole build;
 * the 3.1.0 gate, run without worktrees, promoted 4 of 4 at the same moment.
 * The work directory's tree is the one that passed, and its config hashes are
 * the merged result's hashes. Non-worktree mode passes the root, as before.
 */
export function bootstrapFinalizeDeps(
  root: string,
  workDir: string,
  note: (text: string) => void,
): Parameters<typeof finalizeBootstrap>[2] {
  return {
    readBindings: () => readBindings(root),
    writeBindings: (file) => writeBindings(root, file as { bindings: Binding[]; skips: never[] }),
    rediscover: () => discover(workDir).candidates,
    note,
  };
}

/**
 * PRDR-218's other half: a root the defect already left behind heals at the
 * next pool. A provisional binding after the bootstrap ticket is DONE is a
 * stranded record — the merge landed, the baseline did not — so the same
 * finalize runs from the root, which by then carries the scaffold. A crash
 * between the merge and the bindings write heals the same way. A slot nothing
 * discoverable backs stays provisional, as C-4 says, and is asked again next
 * pool; that costs one discovery per pool and is the honest record.
 */
export function promoteBootstrapBindings(root: string, note: (text: string) => void): boolean {
  const bootstrap = allTickets(root).find((t) => t.id === BOOTSTRAP_TICKET_ID);
  if (bootstrap === undefined || bootstrap.state !== "DONE") return false;
  const provisional = readBindings(root).bindings.filter((b) => b.status === "provisional");
  if (provisional.length === 0) return false;
  /*
   * Audit of PRDR-218: discovery is asked once, and the finalize runs only when
   * it can promote something. Left to itself it wrote "0 provisional binding(s)
   * finalized … stayed provisional" on EVERY pool for a slot nothing backs.
   */
  const found = discover(root).candidates;
  if (!provisional.some((b) => found.some((c) => c.slot === b.slot))) return false;
  const deps = { ...bootstrapFinalizeDeps(root, root, (text) => note(`late (PRDR-218): ${text}`)), rediscover: () => found };
  return finalizeBootstrap(root, BOOTSTRAP_TICKET_ID, deps);
}
