import { createInterface } from "node:readline/promises";
import type { ApprovalDecision } from "../init/present.js";

/**
 * C-7's inline approval prompt. The dual exit means declining here is not a
 * failure — the plan stays READY-unapproved and `detent run` presents it
 * again, so a user who wants to read the tickets first can simply say no.
 */
export function makeTtyApproval(user: string): (presentation: string) => Promise<ApprovalDecision> {
  return async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (await rl.question("\nApprove this plan? [y]es / [n]o / [l]ater ")).trim().toLowerCase();
        if (answer === "y" || answer === "yes") return { kind: "approved", by: user };
        if (answer === "n" || answer === "no") return { kind: "declined" };
        if (answer === "l" || answer === "later" || answer === "") return { kind: "deferred" };
        process.stdout.write("  (answer y, n, or l)\n");
      }
    } finally {
      rl.close();
    }
  };
}
