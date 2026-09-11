import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { ledgerRowSchema, transitionLineSchema, type LedgerRow, type TransitionLine } from "../schemas/records.js";

/**
 * T-041 — the run-level journals (F-1, N-5).
 *
 * `transitions.jsonl` and `ledger.jsonl` are run-level and **single-writer**:
 * exactly one process appends to each for the lifetime of a run. That is not
 * guaranteed by claims — a claim scopes a ticket, not the run journal — so this
 * module holds a writer registry and refuses to open a second journal on the
 * same root. Within-process, that discharges F-1's single-writer AC (R-8);
 * cross-process protection is NG4 ground, documented, not silently claimed.
 *
 * Every line is schema-validated before it is written: N-5 promises the run is
 * reconstructable from these files, which is only true if nothing malformed
 * ever lands in them.
 */

const OPEN_ROOTS = new Set<string>();

class JournalContendedError extends Error {
  constructor(readonly root: string) {
    super(
      `a run journal is already open for ${root} — ledger.jsonl and transitions.jsonl are single-writer ` +
        `for the lifetime of a run (F-1)`,
    );
    this.name = "JournalContendedError";
  }
}

export class RunJournal {
  private closed = false;

  private constructor(private readonly root: string) {}

  static open(root: string): RunJournal {
    const key = path.resolve(root);
    if (OPEN_ROOTS.has(key)) throw new JournalContendedError(root);
    OPEN_ROOTS.add(key);
    mkdirSync(stateDir(root), { recursive: true });
    return new RunJournal(root);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    OPEN_ROOTS.delete(path.resolve(this.root));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("run journal is closed");
  }

  appendTransition(line: TransitionLine): void {
    this.assertOpen();
    appendFileSync(path.join(stateDir(this.root), "transitions.jsonl"), `${JSON.stringify(transitionLineSchema.parse(line))}\n`);
  }

  appendLedger(row: LedgerRow): void {
    this.assertOpen();
    appendFileSync(path.join(stateDir(this.root), "ledger.jsonl"), `${JSON.stringify(ledgerRowSchema.parse(row))}\n`);
  }

  /*
   * ---- per-ticket session journal (B-5). Keyed per ticket, serialized by the
   * C-9 claim, so it is not part of the single-writer registry.
   */

  ticketJournalPath(ticketId: string): string {
    return path.join(stateDir(this.root), "runs", ticketId, "journal.jsonl");
  }

  appendTicketEvent(ticketId: string, record: Readonly<Record<string, unknown>>): void {
    this.assertOpen();
    const file = this.ticketJournalPath(ticketId);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`);
  }

  /**
   * B-5: a `start` with no matching `end` means the process died mid-session.
   * The budget was consumed; the session may NOT relaunch, and the gate judges
   * the tree as-is.
   *
   * B-5′ (PRDR-131): scoped to the GENERATION, which this took no account of.
   * The journal is per-ticket and the skip event rebalances nothing, so
   * `starts > ends` stayed true for the ticket's whole life: one killed session
   * suppressed that role forever. X-8 defines a new generation by zeroed
   * counters, so B-5's premise — the budget was consumed — is simply false
   * across one, and the ladder went on spending real money fixing an
   * implementation that had never been written. Requeue, the documented
   * remedy, could not clear it.
   *
   * An event with no `generation` was written before this was recorded at all;
   * counting it toward generation 0 is the conservative reading, and preserves
   * B-5 for the in-flight resume it was written for.
   */
  unfinished(ticketId: string, role: string, generation: number): boolean {
    const file = this.ticketJournalPath(ticketId);
    if (!existsSync(file)) return false;
    let starts = 0;
    let ends = 0;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      /**
       * F-3′ (PRDR-137): a torn line is skipped. This is read on the resume
       * path a crash produces, and a crash is exactly what tears the last line
       * of an append-only file — so an unguarded parse killed the recovery it
       * exists to serve. `readRecordedSpend` guarded the identical parse with
       * "a torn line cannot subtract money"; the journal readers were missed.
       */
      let record: { stage?: string; event?: string; generation?: unknown };
      try {
        record = JSON.parse(line) as typeof record;
      } catch {
        continue;
      }
      if (record.stage !== role) continue;
      if ((typeof record.generation === "number" ? record.generation : 0) !== generation) continue;
      if (record.event === "start") starts += 1;
      /**
       * PRDR-234: the skip DISCHARGES the start it was written for.
       *
       * B-5 skips the launch that crashed, once. This counted only `start` and
       * `end`, and the skip event is neither — so the imbalance that fired the
       * skip survived it, and every later launch of that role in that
       * generation was skipped in turn. B-5′ above fixed the SCOPE and left the
       * imbalance exactly as it found it, which is why the sentence it wrote —
       * "the skip event rebalanced neither" — still described the code.
       *
       * It hid because the ladder normally moves ON after a skip: blind_fix to
       * research to informed_fix, different roles, separate tallies. The role
       * the ladder RE-ENTERS is REVIEW_FIX, and on gate-313 that spent two of
       * t-s01-012's three review-fix rounds on launches that never happened,
       * re-reviewed an unchanged tree each time, and halted the run on a
       * NEEDS_HUMAN whose finding no fixer had ever been handed.
       *
       * Counted here rather than by appending a synthetic `end`, because `end`
       * carries `ok` and `cost` that every ledger and report reader trusts: a
       * fabricated one would claim a session ran. The journal keeps saying,
       * truthfully, that it did not.
       */
      else if (record.event === "end" || record.event === "skipped_after_crash") ends += 1;
    }
    return starts > ends;
  }
}

export function runsDir(root: string, ticketId: string): string {
  return path.join(stateDir(root), "runs", ticketId);
}
