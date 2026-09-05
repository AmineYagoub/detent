import type { PlanReview } from "../schemas/init.js";
import type { SymbolsConfig } from "../adapter/symbols.js";

/**
 * S-3″ (PRDR-121) — the reminder, earned rather than periodic.
 *
 * A tool nobody installs helps nobody, so Detent should say something. But
 * PRDR-119 was spent removing noise that buried the signal, and a standing
 * banner is that mistake in a different costume.
 *
 * So the rule is narrow: Detent mentions symbol intelligence ONLY when the run
 * that just finished contains evidence it would have helped, and it says what
 * that evidence cost. No evidence, no message — ever. And the way to silence
 * it permanently is in the message itself, because a reminder you cannot turn
 * off is a nag.
 */

/** A finding counts as evidence when its subject is a name a symbol lookup could have settled. */
export function symbolEvidence(findings: readonly PlanReview["findings"][number][]): { readonly ticket: string; readonly name: string }[] {
  const out: { ticket: string; name: string }[] = [];
  for (const f of findings) {
    if (f.tag !== "coherence" && f.tag !== "dependency") continue;
    const match = /`(symbol:)?([A-Za-z_][\w./-]*\.[A-Za-z_]\w*)`/.exec(f.finding);
    if (match === null || f.ticket === undefined) continue;
    out.push({ ticket: f.ticket, name: match[2] as string });
  }
  return out;
}

/**
 * The message, or nothing at all. `enabled: false` is honoured absolutely: a
 * user who declined once is never asked again, under any circumstances.
 */
export function symbolReminder(
  config: SymbolsConfig | undefined,
  findings: readonly PlanReview["findings"][number][],
): string | null {
  if (config?.enabled === true) return null;
  if (config !== undefined && !config.enabled) return null;

  const evidence = symbolEvidence(findings);
  if (evidence.length === 0) return null;

  const shown = evidence.slice(0, 3).map((e) => `${e.ticket} → ${e.name}`);
  const pinned = config?.pinned ?? "0.1.4";
  return [
    "",
    `Symbol intelligence is not configured. ${evidence.length} finding(s) in this plan were symbol-level`,
    "couplings Detent could have checked mechanically instead of leaving to review:",
    `  ${shown.join("      ")}${evidence.length > shown.length ? `      (+${evidence.length - shown.length} more)` : ""}`,
    "",
    `  Install:  uv tool install -p 3.13 serena-agent==${pinned}`,
    '  Enable:   "symbols": { "enabled": true }   in .detent/config.json',
    '  Silence:  "symbols": { "enabled": false }  — never mentioned again',
  ].join("\n");
}
