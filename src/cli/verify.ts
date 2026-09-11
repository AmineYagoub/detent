import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { discover } from "../adapter/discover/index.js";
import { acknowledgeSkip, bindAll, type BindAllOptions, type BindReport, type Skip } from "../adapter/bind.js";
import { SETUP_REQUIRED_SLOTS } from "../init/bind.js";
import { checkAll, readBindings, writeBindings, type DriftCheck } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";
import { scrub } from "../kernel/scrub.js";
import { existsSync } from "node:fs";
import { acceptDrift, bindingsForTree } from "../kernel/drift-base.js";
import { git, worktreePath } from "../kernel/git.js";
import { requeueTicket } from "../kernel/plumbing.js";

/**
 * T-027 — `detent verify sync` (C-12 plumbing, V-3).
 *
 * Sync is the sanctioned way to accept legitimate evolution of a gate: it
 * re-runs V-1 in full — discovery, **execution**, approval — and re-baselines.
 * It never re-baselines without consent, because a sync that trusted the new
 * definition on sight would be the very silent re-resolve V-3 forbids.
 */

/** C-11 exit codes are public API. */
export const EXIT_OK = 0;
export const EXIT_NOT_READY = 2;

interface SyncSummary {
  readonly drift: readonly DriftCheck[];
  readonly proposed: readonly Binding[];
  readonly stored: readonly Binding[];
  /**
   * V-1 (PRDR-167): what will be WRITTEN as skipped, not what was stored.
   *
   * `verifySync` re-derived all six slots and never read `report.unbound`,
   * writing the fresh bindings beside the OLD skips array — so a slot that
   * lost its candidate appeared in neither list, `runScopedGates` skipped it
   * without consulting `skips`, and tickets reached DONE having never run it.
   * `src/init/bind.ts` has always done this correctly; this file had none of
   * that logic, in the command the drift message tells the operator to run.
   */
  readonly skips: readonly Skip[];
  /**
   * V-1‴ (PRDR-165): bound gates that may verify nothing, IN the summary.
   *
   * These were pushed into `messages`, which `main` prints after `verifySync`
   * returns — i.e. after the consent prompt and after `writeBindings`. So the
   * operator approved a re-baseline, the halt cleared, and only then were they
   * told the new gate is `echo`. `sync` is the one path whose purpose is
   * accepting a CHANGED binding, which is exactly where a real gate can be
   * swapped for a vacuous one, so this belongs in the text they decide on.
   */
  readonly notices: readonly string[];
}

type ConsentPrompt = (summary: SyncSummary) => Promise<boolean>;

export interface VerifySyncDeps {
  readonly consent: ConsentPrompt;
  readonly bind?: (report: ReturnType<typeof discover>, opts: BindAllOptions) => Promise<BindReport>;
  readonly now?: () => string;
  readonly user?: string;
  readonly write?: boolean;
}

export interface SyncResult {
  readonly exitCode: number;
  readonly summary: SyncSummary;
  readonly rebaselined: boolean;
  readonly messages: readonly string[];
}

export async function verifySync(root: string, deps: VerifySyncDeps): Promise<SyncResult> {
  const messages: string[] = [];
  const stored = readBindings(root);
  const discovery = discover(root);
  const drift = checkAll(stored.bindings, discovery).checks;

  /**
   * V-1 in full: the replacement candidates are executed before they may be
   * approved, exactly as at init. A sync that skipped execution would approve
   * an unexecuted binding, which P4 calls a guess.
   */
  const at = deps.now?.() ?? new Date().toISOString();
  const bind = deps.bind ?? bindAll;
  const report = await bind(discovery, {
    root,
    approvedBy: deps.user ?? "auto",
    status: "approved",
    /* SEC-4 (PRDR-163): notices quote the project's own command output and this path prints them. */
    redact: scrub,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  /**
   * PRDR-167: a setup-required slot with no candidate is a refusal, not a
   * silent deletion — the same line `init` draws, for the same reason (P2: a
   * project with no test command cannot be gated).
   */
  const missingRequired = report.unbound.filter((slot) => SETUP_REQUIRED_SLOTS.includes(slot));
  if (missingRequired.length > 0) {
    /**
     * PRDR-179: the notices go FIRST, on this path too.
     *
     * This returned before the `messages.push(notice)` loop below and never
     * calls `deps.consent`, so `renderSyncSummary` never runs either — leaving
     * the vacuous-gate notice with nowhere to appear on one of three exits.
     * PRDR-167 closed that hole for the normal path and reopened it here by
     * adding a new early return above the loop.
     */
    for (const notice of report.notices) messages.push(notice);
    messages.push(
      `no way to run: ${missingRequired.join(", ")} — a project with no test command cannot be gated (P2). ` +
        "Establish the tooling and re-run `detent verify sync`; syncing now would leave the gate unrecorded.",
    );
    return {
      exitCode: EXIT_NOT_READY,
      summary: { drift, proposed: report.bindings, stored: stored.bindings, skips: stored.skips, notices: report.notices },
      rebaselined: false,
      messages,
    };
  }

  /**
   * Every remaining unbound slot is an ordinary acknowledged skip (V-1), and a
   * slot that BOUND this time is no longer skipped — `stored.skips` was carried
   * forward unfiltered, so a re-bound slot was listed as bound and skipped at
   * once and `bindingTable` rendered it twice.
   */
  const storedBySlot = new Map(stored.skips.map((skip) => [skip.slot, skip]));
  const skips: Skip[] = report.unbound
    .filter((slot) => !SETUP_REQUIRED_SLOTS.includes(slot))
    /**
     * An EXISTING acknowledgement is kept verbatim — who accepted the gap and
     * when is the whole value of a skip, and re-stamping it `auto`/now would
     * quietly launder a human decision into a machine one. Only a slot with no
     * record gets a fresh one. A slot that BOUND this time keeps no skip at
     * all, which is the contradiction `stored.skips` used to carry forward.
     */
    .map((slot) => storedBySlot.get(slot) ?? acknowledgeSkip(slot, deps.user ?? "auto", at));

  /**
   * V-1‴ (PRDR-167): in `messages` as well as the summary.
   *
   * PRDR-165 moved these into `SyncSummary` so they reach the operator BEFORE
   * they consent — correct, and it left `--yes` with nowhere to show them,
   * because that branch returns true without ever rendering the summary. That
   * is the one path with no human at a terminal. The summary is the decision;
   * `messages` is the log, and an unattended run deserves the log.
   */
  for (const notice of report.notices) messages.push(notice);

  for (const interrupt of report.interrupts) {
    messages.push(
      interrupt.kind === "choice-required"
        ? `${interrupt.slot}: ${interrupt.candidates.length} plausible candidates — resolve the choice before syncing.`
        : `${interrupt.slot}: ${interrupt.explanation}`,
    );
  }
  if (report.interrupts.length > 0) {
    return {
      exitCode: EXIT_NOT_READY,
      summary: { drift, proposed: report.bindings, stored: stored.bindings, skips, notices: report.notices },
      rebaselined: false,
      messages,
    };
  }

  const summary: SyncSummary = { drift, proposed: report.bindings, stored: stored.bindings, skips, notices: report.notices };
  if (!(await deps.consent(summary))) {
    messages.push("sync declined — bindings unchanged, verification still halted (V-3).");
    return { exitCode: EXIT_NOT_READY, summary, rebaselined: false, messages };
  }

  if (deps.write !== false) {
    writeBindings(root, { bindings: [...report.bindings], skips: [...skips] });
  }
  messages.push(`re-baselined ${report.bindings.length} binding(s).`);
  return { exitCode: EXIT_OK, summary, rebaselined: true, messages };
}

/*
 * ---------------------------------------------------------------------------
 * The verb (PRDR-141)
 */

/**
 * V-3 (PRDR-141): `detent verify sync`, routed at last.
 *
 * `verifySync` has been implemented, tested and documented since T-027, and
 * absent from the dispatcher the whole time — while `adapter/drift.ts` tells an
 * operator to run it to clear a drift halt. Every drift-blocked ticket has
 * therefore been stuck behind an instruction that answers `unknown command`.
 *
 * The consent is a real prompt on a TTY and a refusal elsewhere: re-baselining
 * a verification binding is a human decision (C-6a), and a non-interactive
 * caller must not be taken to have made it.
 */
/**
 * V-3‴ (PRDR-226): accept ONE ticket's verification change.
 *
 * Under worktrees the change lives on the ticket's branch, so the root has
 * nothing to re-baseline. This judges the ticket's tree against the base it
 * started from (drift-base.ts), executes the bound gates THERE with the same
 * consent the root sync takes (PRDR-165: never an unexecuted acceptance),
 * records the accepted hashes on the ticket, and requeues it. The root's
 * baseline follows at the merge, where the run branch actually changes.
 */
/**
 * The run branch a ticket's worktree was cut from.
 *
 * Audit of PRDR-230: this guessed, and the guess had a success path that
 * silently collapsed the whole check. `git rev-parse --abbrev-ref HEAD` does
 * not throw on a detached root — it prints the literal `HEAD` and exits 0, so
 * the catch was dead code — and `git merge-base HEAD HEAD` inside the worktree
 * then returns the ticket's OWN tip, making the tree its own baseline. The
 * accept verb reported "nothing to accept" and exit 0 while leaving the ticket
 * blocked. Now a name that is not a real branch is refused rather than used,
 * and the run branch is recovered from the one `detent/run-*` head when the
 * root is not sitting on it.
 */
function runBranchOf(root: string): string | null {
  const named = tryGitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (named !== null && named !== "HEAD" && tryGitLine(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${named}`]) !== null) {
    return named;
  }
  const runs = (tryGitLine(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/detent/run-*"]) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return runs.length === 1 ? (runs[0] as string) : null;
}

function tryGitLine(root: string, args: readonly string[]): string | null {
  try {
    const out = git(root, ...args).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

export async function acceptTicketDrift(root: string, id: string, deps: VerifySyncDeps): Promise<SyncResult> {
  const messages: string[] = [];
  const stored = readBindings(root);
  const tree = worktreePath(root, id);
  const summaryOf = (drift: readonly DriftCheck[], proposed: readonly Binding[], notices: readonly string[]): SyncSummary =>
    ({ drift, proposed, stored: stored.bindings, skips: [...stored.skips], notices });
  if (!existsSync(tree)) {
    messages.push(`${id}: no worktree at ${tree} — nothing to judge (B-2″)`);
    return { exitCode: EXIT_NOT_READY, summary: summaryOf([], [], []), rebaselined: false, messages };
  }
  const discovery = discover(tree);
  const runBranch = runBranchOf(root);
  if (runBranch === null) {
    messages.push(
      `${id}: cannot tell which run branch this worktree was cut from — the root is not checked out on a branch, ` +
        "and there is not exactly one `detent/run-*` head to fall back to. Check the root out on its run branch and retry.",
    );
    return { exitCode: EXIT_NOT_READY, summary: summaryOf([], [], []), rebaselined: false, messages };
  }
  const drift = checkAll(bindingsForTree(root, id, tree, runBranch), discovery).checks;
  const halting = drift.filter((d) => d.status === "drifted" || d.status === "vanished");
  if (halting.length === 0) {
    messages.push(`${id}: its tree matches the baseline it started from — nothing to accept`);
    return { exitCode: EXIT_OK, summary: summaryOf(drift, [], []), rebaselined: false, messages };
  }
  const at = deps.now?.() ?? new Date().toISOString();
  const bind = deps.bind ?? bindAll;
  const report = await bind(discovery, {
    root: tree,
    approvedBy: deps.user ?? "auto",
    status: "approved",
    redact: scrub,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  for (const notice of report.notices) messages.push(notice);
  const summary = summaryOf(drift, report.bindings, report.notices);
  const missing = report.unbound.filter((slot) => SETUP_REQUIRED_SLOTS.includes(slot));
  if (missing.length > 0 || report.interrupts.length > 0) {
    messages.push(`${id}: its tree cannot be gated as it stands (${[...missing, ...report.interrupts.map((i) => i.slot)].join(", ")}) — a change that removes a gate is not accepted (P2)`);
    return { exitCode: EXIT_NOT_READY, summary, rebaselined: false, messages };
  }
  if (!(await deps.consent(summary))) {
    messages.push("declined — the ticket stays blocked (V-3).");
    return { exitCode: EXIT_NOT_READY, summary, rebaselined: false, messages };
  }
  const hashes = Object.fromEntries(halting.flatMap((d) => (typeof d.current_hash === "string" ? [[d.slot, d.current_hash]] : [])));
  if (deps.write !== false) {
    acceptDrift(root, id, deps.user ?? "operator", at, hashes);
    messages.push(requeueTicket(root, id, deps.user ?? "operator", `verification change accepted (V-3‴): ${Object.keys(hashes).join(", ")}`).message);
  }
  messages.push(`accepted ${Object.keys(hashes).length} change(s) for ${id}; the root's baseline follows at the merge.`);
  return { exitCode: EXIT_OK, summary, rebaselined: true, messages };
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false }, ticket: { type: "string" } },
  });
  const [sub, maybeRoot] = positionals;
  if (sub !== "sync") {
    process.stderr.write("usage: detent verify sync [root] [--yes] [--ticket <id>]\n");
    return 2;
  }
  const root = maybeRoot ?? process.cwd();
  const interactive = process.stdout.isTTY === true && process.stdin.isTTY === true;

  /**
   * PRDR-154: refuse BEFORE `verifySync`, not inside its consent callback.
   *
   * V-1/P4 require the replacement candidates to be EXECUTED before they may be
   * approved — a sync that approved an unexecuted binding would be approving a
   * guess — so `verifySync` binds before it asks. That is correct, and it means
   * a consent callback that answers "no" has already let every discovered gate
   * command run. Off a terminal the refusal has to happen here, where it can
   * still prevent the running.
   */
  if (!interactive && values.yes !== true) {
    process.stderr.write(
      "re-baselining a verification binding executes the candidate commands and is a human decision (C-6a, V-1) — " +
        "re-run on a terminal, or pass --yes to accept that.\n",
    );
    return 2;
  }

  const deps: VerifySyncDeps = {
    user: process.env["USER"] ?? "operator",
    consent: async (summary) => {
      if (values.yes === true) return true;
      /**
       * PRDR-154: `readline/promises`, matching `makeTtyApproval` and
       * `makeTtyEscalation` rather than being a third transport — and with a
       * `close` handler, because a raw `stdin.once("data")` never settles on
       * Ctrl-D and left the stream flowing with a listener attached.
       *
       * The wording says the commands have already run: V-1 requires it, and a
       * prompt that implies otherwise misdescribes the decision being made.
       */
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answered = await Promise.race([
          rl.question(`${renderSyncSummary(summary)}\nThese commands have been executed (V-1). Accept them as the new baseline? [y/N] `),
          new Promise<string>((resolve) => rl.once("close", () => resolve("n"))),
        ]);
        return answered.trim().toLowerCase().startsWith("y");
      } finally {
        rl.close();
      }
    },
  };
  /* V-3‴ (PRDR-226): a ticket's own change is accepted in its tree; the root sync stays what it was. */
  const result = values.ticket === undefined ? await verifySync(root, deps) : await acceptTicketDrift(root, values.ticket, deps);
  for (const message of result.messages) process.stdout.write(`${message}\n`);
  return result.exitCode;
}

/** What a human is shown before they accept a re-baseline. */
export function renderSyncSummary(summary: SyncSummary): string {
  const lines = ["", "verification bindings to re-baseline (V-3):"];
  for (const check of summary.drift) lines.push(`  [${check.status}] ${check.message}`);
  for (const b of summary.proposed) lines.push(`  ${b.slot}: \`${b.resolved}\` (${b.adapter}:${b.ref})`);
  /**
   * PRDR-179: the skips, in the text the operator consents to.
   *
   * PRDR-167 put them on `SyncSummary` and documented them as what will be
   * WRITTEN, and then rendered them nowhere — so the human approving a
   * re-baseline was never told which gates were about to be recorded as
   * skipped. Adding a field to the decision object is not the same as adding
   * it to the decision.
   */
  for (const skip of summary.skips) {
    lines.push(`  ${skip.slot}: no candidate — recorded as skipped, acknowledged by ${skip.acknowledged_by}`);
  }
  /** PRDR-165: before the decision, not after it. */
  if (summary.notices.length > 0) {
    lines.push("", `Gates that may verify nothing (${summary.notices.length}) — evidence, not a refusal (V-1‴):`);
    for (const n of summary.notices) lines.push(`  ${n}`);
  }
  return lines.join("\n");
}
