import type { GateResult } from "../../adapter/run.js";
import { parseArtifact } from "../../schemas/common.js";
import { hypothesisSchema, type Hypothesis } from "../../schemas/records.js";
import { reproAsPredicted, reproWrong, type KernelEvent } from "../events.js";

/**
 * T-043 — the diagnosis gate (X-4, D-7).
 *
 * A root cause is inadmissible as prose. The diagnose session emits an A-3
 * hypothesis; the KERNEL executes the repro and requires fail-as-predicted
 * before IN_PROGRESS. This is the module T-041 refused to fake: without the
 * execution below, admitting a hypothesis would advance a ticket on an
 * unverified model claim (P2).
 */

export interface DiagnoseDeps {
  /** Launch the diagnose session (the loop owns session mechanics). */
  readonly launch: () => Promise<void>;
  /** The session's artifact, parsed JSON or null when absent/unreadable. */
  readonly readArtifact: () => unknown;
  /** Persist the verified/falsified status back onto the artifact. */
  readonly writeArtifact: (h: Hypothesis) => void;
  /** Execute the repro command — a real gate run, kernel-owned (X-4). */
  readonly executeRepro: (command: string) => Promise<GateResult>;
  readonly note: (text: string) => void;
}

export interface DiagnoseOutcome {
  readonly event: KernelEvent;
  /** Present when a hypothesis was admitted — the loop hands it to later stages. */
  readonly hypothesis?: Hypothesis;
}

export async function diagnoseStage(deps: DiagnoseDeps): Promise<DiagnoseOutcome> {
  await deps.launch();

  const raw = deps.readArtifact();
  const parsed = raw === null ? null : parseArtifact(hypothesisSchema, raw);
  if (parsed === null || !parsed.ok) {
    const detail = parsed === null ? "no hypothesis artifact" : "hypothesis invalid (A-3)";
    deps.note(`${detail} — counted against hypotheses (X-1)`);
    return { event: reproWrong({ invalidArtifact: detail }) };
  }

  const hypothesis = parsed.value;
  /**
   * X-4: the kernel runs the repro. A red repro whose output contains the
   * predicted substring is fail-as-predicted; anything else falsifies.
   */
  const repro = await deps.executeRepro(hypothesis.repro_test);
  const predicted = hypothesis.predicted_failure.trim().toLowerCase();
  const asPredicted = !repro.green && (predicted === "" || repro.output.toLowerCase().includes(predicted));

  if (asPredicted) {
    deps.writeArtifact({ ...hypothesis, status: "confirmed" });
    return { event: reproAsPredicted(repro), hypothesis: { ...hypothesis, status: "confirmed" } };
  }

  const why = repro.green ? "repro passed" : "repro failed for a different reason";
  deps.writeArtifact({ ...hypothesis, status: "falsified" });
  deps.note(`hypothesis falsified at the gate: ${why}`);
  return { event: reproWrong({ repro, why }) };
}
