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
