import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { discover } from "../adapter/discover/index.js";
import { bindAll, type BindOptions, type BindReport } from "../adapter/bind.js";
import { checkAll, readBindings, writeBindings, type DriftCheck } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";

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
}

type ConsentPrompt = (summary: SyncSummary) => Promise<boolean>;

export interface VerifySyncDeps {
  readonly consent: ConsentPrompt;
  readonly bind?: (report: ReturnType<typeof discover>, opts: BindOptions) => Promise<BindReport>;
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
  const bind = deps.bind ?? bindAll;
  const report = await bind(discovery, {
    root,
    approvedBy: deps.user ?? "auto",
    status: "approved",
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

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
      summary: { drift, proposed: report.bindings, stored: stored.bindings },
      rebaselined: false,
      messages,
    };
  }

  const summary: SyncSummary = { drift, proposed: report.bindings, stored: stored.bindings };
  if (!(await deps.consent(summary))) {
    messages.push("sync declined — bindings unchanged, verification still halted (V-3).");
    return { exitCode: EXIT_NOT_READY, summary, rebaselined: false, messages };
  }

  if (deps.write !== false) {
    writeBindings(root, { bindings: [...report.bindings], skips: stored.skips });
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
export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  const [sub, maybeRoot] = positionals;
  if (sub !== "sync") {
    process.stderr.write("usage: detent verify sync [root] [--yes]\n");
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

  const result = await verifySync(root, {
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
  });
  for (const message of result.messages) process.stdout.write(`${message}\n`);
  return result.exitCode;
}

/** What a human is shown before they accept a re-baseline. */
export function renderSyncSummary(summary: SyncSummary): string {
  const lines = ["", "verification bindings to re-baseline (V-3):"];
  for (const check of summary.drift) lines.push(`  [${check.status}] ${check.message}`);
  for (const b of summary.proposed) lines.push(`  ${b.slot}: \`${b.resolved}\` (${b.adapter}:${b.ref})`);
  return lines.join("\n");
}
