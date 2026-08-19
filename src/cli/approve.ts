import { createInterface } from "node:readline/promises";
import type { ApprovalDecision } from "../init/present.js";

/**
 * C-7's inline approval prompt. The dual exit means declining here is not a
 * failure — the plan stays READY-unapproved and `detent run` presents it
 * again, so a user who wants to read the tickets first can simply say no.
 */

/** The one C-5 decision a flag may answer (T-131). */
export type ApprovalFlag = "approve" | "decline" | "defer";

/**
 * T-131 — `makeTtyApproval`, re-surfaced for the plugin path (C-1′/C-7).
 * Inside a plugin session there is no readline: the MODEL presents the plan
 * and the human answers in chat; the model then relays exactly one of
 * `--approve --by <name>` / `--decline` / `--defer` on the C-8 re-invocation.
 * Same ask seam, same three outcomes, same who/when/plan_hash record — only
 * the transport of the human's answer differs.
 */
export function makeFlagApproval(flag: ApprovalFlag, by: string): (presentation: string) => Promise<ApprovalDecision> {
  return async () => {
    if (flag === "approve") return { kind: "approved", by };
    if (flag === "decline") return { kind: "declined" };
    return { kind: "deferred" };
  };
}
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
