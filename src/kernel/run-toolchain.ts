import {
  currentPlatform,
  installReport,
  installToolchains,
  missingToolchains,
  probeExecutable,
  runInstallCommand,
  toolchainSetupMessage,
  type InstallAttempt,
  type Platform,
} from "../adapter/toolchain.js";
import type { ToolchainResume } from "./referee-sweeps.js";

/**
 * PRDR-276 — `run` checks the toolchain behind every bound gate before its
 * first session, and installs a missing one only on the operator's answer.
 *
 * Here and not in `init`, for two reasons. An approved plan's `init` runs no
 * phase at all (C-8), so an install that lived in `init`'s binding phase —
 * PRDR-274's — could never reach a project that had already planned; ksar-cloud
 * was such a project the day it shipped. And planning needs no compiler, while
 * the first gate a run executes does: the question belongs where the need
 * first arises, before anything is spent on discovering it.
 */

/** PRDR-276: what the check needs from `run`; the real probe and installer by default. */
export interface ToolchainSeams {
  /**
   * The operator's answer — a terminal's `[y/N]`, or `--install-toolchain`
   * relayed. Absent means no human is present, and nothing is synthesized in
   * their place (C-5).
   */
  readonly approve?: (message: string) => Promise<boolean>;
  readonly probe?: (exe: string) => boolean;
  readonly install?: (exe: string, args: readonly string[]) => void;
  readonly platform?: Platform;
  readonly announce?: (message: string) => void;
}

/** PRDR-277: a ticket its session stopped on a false premise, as the question names it. */
export interface StrandedTicket {
  readonly id: string;
  /** The premise, in the session's words. */
  readonly reason: string;
}

export type ToolchainOutcome =
  | {
      readonly ready: true;
      readonly attempts: readonly InstallAttempt[];
      /** PRDR-277: what the install's yes returns to the queue; null when nothing was installed. */
      readonly resume: ToolchainResume | null;
    }
  | { readonly ready: false; readonly reason: string };

/** How much of each premise the question quotes: enough to recognise, not a dossier. */
const PREMISE_QUOTED = 200;

/**
 * PRDR-277: the rest of what a yes does. Said inside the question, not after
 * it, because the requeue is only a human act if the human was shown it.
 */
function strandedSection(stranded: readonly StrandedTicket[]): string {
  if (stranded.length === 0) return "";
  const lines = stranded.map((t) => {
    const premise = t.reason.length > PREMISE_QUOTED ? `${t.reason.slice(0, PREMISE_QUOTED)}…` : t.reason;
    return `  ${t.id} — ${premise}`;
  });
  return [
    "",
    "",
    `A yes also returns ${String(stranded.length)} ticket(s) to the queue. Each stopped on a premise its session found false (X-4);`,
    "a fresh attempt re-tests that premise with the toolchain installed:",
    ...lines,
  ].join("\n");
}

/**
 * PRDR-276: ready when every table executable the bindings name runs — after
 * an approved install, if one was needed. The message is announced before the
 * question, so what a human answers is what they were shown; the outcome is
 * announced after the install, so a detached run's log says what it changed.
 *
 * PRDR-277: `strandedTickets` is what the same yes returns to the queue. It is
 * named in the message and handed back only when something was installed:
 * with the toolchain already present nothing is asked, so nothing is returned
 * — and nothing is read, so a run that installs nothing reads no ticket here.
 */
export async function ensureToolchains(
  bindings: readonly { readonly slot: string; readonly resolved: string }[],
  seams: ToolchainSeams,
  strandedTickets: () => readonly StrandedTicket[] = () => [],
): Promise<ToolchainOutcome> {
  const platform = seams.platform ?? currentPlatform();
  const probe = seams.probe ?? ((exe: string): boolean => probeExecutable(exe));
  const missing = missingToolchains(bindings, probe);
  if (missing.length === 0) return { ready: true, attempts: [], resume: null };

  const stranded = strandedTickets();
  const message = toolchainSetupMessage(missing, platform) + strandedSection(stranded);
  seams.announce?.(message);
  const named = missing.map((m) => `${m.exe} (${m.toolchain.install[platform]})`).join(", ");
  const returns = stranded.length === 0 ? "" : ` A yes would also return ${stranded.map((t) => t.id).join(", ")} to the queue.`;
  if (seams.approve === undefined) {
    return {
      ready: false,
      reason:
        `missing toolchain: ${named}. No terminal to ask on — re-run \`detent run --install-toolchain\` to approve ` +
        `installing it, or install it yourself.${returns} Nothing was run and no session started.`,
    };
  }
  if (!(await seams.approve(message))) {
    return {
      ready: false,
      reason: `toolchain install declined: ${named}. Nothing was run and no session started.`,
    };
  }
  const attempts = installToolchains(missing, platform, seams.install ?? runInstallCommand, probe);
  if (attempts.some((a) => !a.resolved)) {
    return { ready: false, reason: `An approved toolchain install did not resolve everything:\n${installReport(attempts)}` };
  }
  seams.announce?.(`Toolchain installed:\n${installReport(attempts)}`);
  const installed = attempts.map((a) => `${a.exe} (${a.command})`).join(", ");
  return { ready: true, attempts, resume: stranded.length === 0 ? null : { ids: stranded.map((t) => t.id), installed } };
}
