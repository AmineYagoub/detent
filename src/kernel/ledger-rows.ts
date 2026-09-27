import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { ledgerRowSchema, type LedgerRow } from "../schemas/records.js";
import { recoverObjects } from "./jsonl-recover.js";

/**
 * X-1 — every row of `ledger.jsonl`, read the one way X-1 trusts.
 *
 * Moved out of `readRecordedSpend` (PRDR-296), which sums these, so a reader
 * that needs the rows rather than their total reads the same ones: PRESENT
 * sums `init`'s by phase (C-7‴). A torn line gives up what was fully written
 * in it, and a well-formed object that is not a row refuses the file.
 */
export function readLedgerRows(root: string): LedgerRow[] {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  const rows: LedgerRow[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      /**
       * PRDR-151: unparseable TEXT is a crash artifact, at any position, and is
       * skipped. The first version of this refused any torn line that was not
       * last — which sounds right and bricks a root: `appendLedger` writes
       * `JSON.stringify(row) + "\n"`, so a line torn mid-append has no trailing
       * newline and the NEXT append concatenates onto it. One `kill -9` then
       * cost a run its next session's spend silently, and the run after that
       * refused at startup forever, with no repair instruction. Reproduced.
       *
       * The distinction that matters is not WHERE the damage is but WHAT it is:
       * text that is not JSON is a torn write; a well-formed object that is not
       * a ledger row is a shape the writer cannot produce. Only the second is
       * worth halting for, and it is the one X-1⁷ was actually about.
       *
       * PRDR-249: what is skipped is the FRAGMENT, not the line. This block
       * claimed the loss was "at most the row glued to the torn one" and it was
       * larger — a tear at the record separator leaves two COMPLETE rows on one
       * line and `JSON.parse` rejects the pair for trailing content, so 10/100/1
       * torn after the first row's closing brace read back 1. `recoverObjects`
       * digs out every object that was fully written; only the fragment, whose
       * bytes stopped mid-flight and whose cost is genuinely unknown, is lost.
       *
       * A recovered object that is not a ledger row is SKIPPED rather than
       * throwing, unlike the intact-line case below. X-1⁷ is that the ceiling
       * cannot trust a shape its WRITER could not produce; an object dug out of
       * a damaged line is a crash artifact, and PRDR-151's lesson is that a
       * crash artifact must never brick a root.
       */
      for (const recovered of recoverObjects(line)) {
        const recoveredRow = ledgerRowSchema.safeParse(recovered);
        if (recoveredRow.success) rows.push(recoveredRow.data);
      }
      continue;
    }
    const parsed = ledgerRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `.detent/ledger.jsonl line ${index + 1} is well-formed JSON but not a ledger row (${parsed.error.issues[0]?.message ?? "invalid"}) — ` +
          "X-1's spend figures are read from this file, and a shape its writer cannot produce is not one they can trust (X-1).",
      );
    }
    rows.push(parsed.data);
  }
  return rows;
}
