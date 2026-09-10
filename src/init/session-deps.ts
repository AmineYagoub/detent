import { readRules } from "../kernel/rules.js";
import type { RunJournal } from "../kernel/journal.js";
import type { InitSessionDeps } from "./session.js";
import type { PipelineDeps } from "./pipeline.js";

/**
 * How an init session is CONFIGURED, separated from what the phases are.
 *
 * Split out of `pipeline.ts` under AGENTS.md's rule to divide by
 * responsibility at the ceiling rather than mechanically. That file answers
 * "which phases exist and what does each run"; this one answers "what is a
 * session given" — the ceilings it is bound by, the rules it is told, the model
 * and effort its role is routed to, and where its progress is reported. Four
 * separate tickets added a field here in one day (PRDR-166, PRDR-191,
 * PRDR-194, PRDR-197), which is what a distinct responsibility looks like when
 * it is still living inside another module.
 */
export function sessionDeps(deps: PipelineDeps, journal: RunJournal): InitSessionDeps {
  return {
    root: deps.root,
    backend: deps.backend,
    prompts: deps.prompts,
    /* PRDR-203: the phase's journal, one for every launch the phase makes. */
    journal,
    spendCeiling: deps.budgets.run_spend_usd,
    ...(deps.note === undefined ? {} : { note: deps.note }),
    /* X-1⁵ (PRDR-191): the breaker's ceilings travel with the total. */
    progressBreaker: {
      spend_without_progress_floor_usd: deps.budgets.spend_without_progress_floor_usd,
      spend_without_progress_multiple: deps.budgets.spend_without_progress_multiple,
      spend_without_progress_sessions: deps.budgets.spend_without_progress_sessions,
    },
    /**
     * PRDR-176: AGENTS.md, which every init session was promised and none
     * received. `InitSessionDeps.rulesText` was declared and consumed —
     * `stablePrefix(prompt, deps.rulesText ?? "(no rules file)", preamble)` —
     * and this, the only production caller, never supplied it. So ANALYZE,
     * SLICE, PLAN and the plan reviews planned this repository without being
     * told its engineering rules, while the rules file's own header says it is
     * fed to every session Detent launches.
     */
    rulesText: readRules(deps.root),
    /**
     * PRDR-185: the outage seam. Without `note` the wait is silent, and a
     * command that appears hung for fifteen minutes is worse than one that
     * fails — the operator is told what is being waited for and for how long.
     */
    ...(deps.note === undefined ? {} : { note: deps.note }),
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.docsDomains === undefined ? {} : { docsDomains: deps.docsDomains }),
    ...(deps.modelRouting === undefined ? {} : { modelRouting: deps.modelRouting }),
    ...(deps.effortRouting === undefined ? {} : { effortRouting: deps.effortRouting }),
  };
}
