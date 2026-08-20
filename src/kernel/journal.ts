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
   */
  unfinished(ticketId: string, role: string): boolean {
    const file = this.ticketJournalPath(ticketId);
    if (!existsSync(file)) return false;
    let starts = 0;
    let ends = 0;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const record = JSON.parse(line) as { stage?: string; event?: string };
      if (record.stage !== role) continue;
      if (record.event === "start") starts += 1;
      else if (record.event === "end") ends += 1;
    }
    return starts > ends;
  }
}

export function runsDir(root: string, ticketId: string): string {
  return path.join(stateDir(root), "runs", ticketId);
}
