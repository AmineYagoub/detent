/**
 * PRDR-190 — say what happened to the process.
 *
 * `init` could not state its own cause of death. Six times across three days a
 * run ended and wrote nothing: no terminal line, no ledger row, no marker. The
 * cause turned out to be `killall node` typed in a terminal — SIGTERM, which a
 * handler catches — and the entire two-day investigation would have been one
 * line in a log had this file existed.
 *
 * Two conclusions were drawn from the silence and both were wrong: a death was
 * timed from the log's last write when the process lived fourteen minutes
 * longer, and an earlier one was blamed on source churn under a live `tsx`. A
 * tool that cannot say why it stopped does not merely fail to inform — the
 * shape of its silence gets read as evidence.
 *
 * Everything here takes its seams by injection because the entry point's own
 * `invoked` block cannot be tested: a record only reachable from there would
 * stop being written the first time somebody refactored around it, which is
 * the V-1‴ shape this repository keeps finding.
 */

export interface ExitRecorderDeps {
  readonly write: (text: string) => void;
  readonly on: (signal: string, handler: () => void) => void;
  readonly exit: (code: number) => void;
  /** What the operator was last told was happening; `null` before any progress. */
  readonly phase: () => string | null;
  /** AGENTS.md: a decision that reads the time takes the clock as a seam. */
  readonly now?: () => Date;
  /**
   * What to call the process in the record. The entry point serves every verb,
   * so a fixed `init:` would be a lie on `detent run` — and a record that
   * misnames what it describes is worse than none.
   */
  readonly label?: string;
}

/**
 * The three a process can catch. SIGKILL is deliberately absent — it cannot be
 * handled, which is why the run lock carries the phase as well: that marker is
 * what makes an uncatchable death diagnosable after the fact.
 */
export const RECORDED_SIGNALS: readonly string[] = ["SIGTERM", "SIGINT", "SIGHUP"];

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/**
 * What the process is doing, for whatever ends it.
 *
 * Module state, deliberately: a process has exactly one exit, so there is
 * exactly one thing in flight, and the alternative is threading a mutable
 * handle from the entry point through every command. The recorder is installed
 * once at the entry point and `init` feeds this as it advances — two installs
 * would mean two records for one signal.
 *
 * `deps.phase` stays injectable so the tests never touch it.
 */
let inFlight: string | null = null;

export function setInFlight(phase: string | null): void {
  inFlight = phase;
}

export function currentInFlight(): string | null {
  return inFlight;
}

export type ExitReason =
  | { readonly kind: "signal"; readonly signal: string }
  | { readonly kind: "return"; readonly code: number };

/**
 * One line, on the channel the operator already reads.
 *
 * Not the ledger: its rows are session-shaped under a strict schema with a
 * closed `partial` enum, so a signal death would need either a migration or a
 * synthetic session — a shape production cannot otherwise emit, which is the
 * defect PRDR-137 and PRDR-188 both record. PRDR-190's criterion 4 is amended
 * to say so rather than satisfied by inventing one.
 */
export function exitRecord(reason: ExitReason, phase: string | null, at: Date, label = "detent"): string {
  const what =
    reason.kind === "signal"
      ? `killed by ${reason.signal}`
      : reason.code === 0
        ? "finished"
        : `exited with code ${String(reason.code)}`;
  const during = phase === null || phase.trim() === "" ? "" : ` while: ${phase}`;
  const advice = reason.kind === "signal" ? " — every finished slice and redraft is checkpointed; re-run to resume" : "";
  return `${label}: ${what} at ${at.toISOString()}${during}${advice}\n`;
}

/**
 * Register the handlers and hand back the recorder for the ordinary path.
 *
 * The ordinary path matters as much as the signals. `main().then(process.exit)`
 * was silent on EVERY code it was handed, so a normal return and an abnormal
 * one were indistinguishable in the log — and a line that always appears at the
 * end is what makes its absence mean something.
 */
export function installExitRecorder(deps: ExitRecorderDeps): (code: number) => void {
  const clock = deps.now ?? ((): Date => new Date());
  const label = deps.label ?? "detent";
  for (const signal of RECORDED_SIGNALS) {
    deps.on(signal, () => {
      deps.write(exitRecord({ kind: "signal", signal }, deps.phase(), clock(), label));
      deps.exit(128 + (SIGNAL_NUMBERS[signal] ?? 0));
    });
  }
  return (code: number): void => {
    deps.write(exitRecord({ kind: "return", code }, deps.phase(), clock(), label));
  };
}
