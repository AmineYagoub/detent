import { createInterface } from "node:readline/promises";
import type { EscalationAction, EscalationInput } from "../kernel/run.js";

/**
 * T-049 — the C-10 TTY escalation flow.
 *
 * Escalations are handled INSIDE `run` on a TTY: dossier summary, then
 * approve / requeue-with-guidance / skip / quit, and the loop continues
 * in-process — plumbing is never required on the golden path. Non-TTY runs
 * never see this: they exit 10 with the machine-readable summary.
 */

export function makeTtyEscalation(user: string): (input: EscalationInput) => Promise<EscalationAction> {
  return async (input) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
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
