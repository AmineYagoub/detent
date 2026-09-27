import { readFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline/promises";
import { z } from "zod";
import { describeAmendment } from "../kernel/amendment-store.js";
import type { EscalationAction, EscalationInput } from "../kernel/run.js";
import { amendmentEditSchema, type AmendmentEdit, type AmendmentRecord } from "../schemas/amendment.js";

/**
 * T-049 — the C-10 TTY escalation flow.
 *
 * Escalations are handled INSIDE `run` on a TTY: dossier summary, then
 * approve / requeue-with-guidance / skip / quit, and the loop continues
 * in-process — plumbing is never required on the golden path. Non-TTY runs
 * never see this: they exit 10 with the machine-readable summary.
 *
 * X-4⁸ (PRDR-286): a ticket that filed an amendment escalates as the
 * amendment: approve / edit / reject / skip / quit, and no ticket act.
 */

export function makeTtyEscalation(user: string): (input: EscalationInput) => Promise<EscalationAction> {
  return async (input) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (input.amendment !== undefined) return await amendmentAnswer(rl, input.amendment, user);
      process.stdout.write(`\n— escalation —\n${input.summary}\n`);
      for (;;) {
        const answer = (await rl.question("approve / requeue / skip / quit? ")).trim().toLowerCase();
        if (answer === "approve" || answer === "a") return { kind: "approve", by: user };
        if (answer === "requeue" || answer === "r") {
          const guidance = (await rl.question("guidance for the fresh generation: ")).trim();
          return { kind: "requeue", by: user, guidance: guidance === "" ? "requeued without guidance" : guidance };
        }
        if (answer === "skip" || answer === "s") return { kind: "skip", by: user };
        if (answer === "quit" || answer === "q") return { kind: "quit" };
        process.stdout.write("  (answer approve, requeue, skip, or quit)\n");
      }
    } finally {
      rl.close();
    }
  };
}

async function amendmentAnswer(rl: Interface, amendment: AmendmentRecord, user: string): Promise<EscalationAction> {
  process.stdout.write(`\n— amendment to the pack —\n${describeAmendment(amendment)}\n`);
  for (;;) {
    const answer = (await rl.question("approve / edit / reject / skip / quit? ")).trim().toLowerCase();
    if (answer === "approve" || answer === "a") return { kind: "amend", by: user, decision: { kind: "approve" } };
    if (answer === "edit" || answer === "e") {
      const edits = readEditsFile((await rl.question('a JSON file of your edits, [{"id", "old", "new"}]: ')).trim());
      if (typeof edits === "string") {
        process.stdout.write(`  ${edits}\n`);
        continue;
      }
      return { kind: "amend", by: user, decision: { kind: "edit", edits } };
    }
    if (answer === "reject" || answer === "r") {
      const reason = (await rl.question("why the pack stands: ")).trim();
      return { kind: "amend", by: user, decision: { kind: "reject", reason: reason === "" ? "rejected without a reason" : reason } };
    }
    if (answer === "skip" || answer === "s") return { kind: "skip", by: user };
    if (answer === "quit" || answer === "q") return { kind: "quit" };
    process.stdout.write("  (answer approve, edit, reject, skip, or quit)\n");
  }
}

/** The operator's own edits, in place of the amendment's: a JSON array of `{id, old, new}`. A string says why the file will not do. */
export function readEditsFile(file: string): AmendmentEdit[] | string {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return `${file} is not a readable JSON file: ${(err as Error).message}`;
  }
  const parsed = z.array(amendmentEditSchema).min(1).safeParse(raw);
  return parsed.success ? parsed.data : `${file} is not a list of edits: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
}
