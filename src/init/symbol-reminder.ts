import type { PlanFinding } from "../schemas/init.js";
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
export function symbolEvidence(findings: readonly PlanFinding[]): { readonly ticket: string; readonly name: string }[] {
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
  findings: readonly PlanFinding[],
): string | null {
  if (config?.enabled === true) return null;
  /**
   * `false` is a person's answer and is honoured absolutely. Absent is not an
   * answer — and it used to be treated as one, which is what made this function
   * unreachable in production: the config schema defaulted `enabled` to false,
   * so every project looked like it had already declined.
   */
  if (config?.enabled === false) return null;

  const evidence = symbolEvidence(findings);
  if (evidence.length === 0) return null;

  const shown = evidence.slice(0, 3).map((e) => `${e.ticket} → ${e.name}`);
  const pinned = config?.pinned ?? "0.1.4";
  /**
   * PRDR-298: what it offers is what it does. `run`'s sessions get the symbol
   * tools (`referee-session.ts`) and no `init` session does, so this said that
   * Detent could have checked these couplings mechanically, and it could not
   * have: the planning that found them runs without the tools either way.
   */
  return [
    "",
    `Symbol intelligence is not configured. ${evidence.length} finding(s) in this plan were symbol-level couplings:`,
    `  ${shown.join("      ")}${evidence.length > shown.length ? `      (+${evidence.length - shown.length} more)` : ""}`,
    "With it, the sessions `detent run` launches can look such names up with read-only symbol tools. Planning's sessions do not get them.",
    "",
    `  Install:  uv tool install -p 3.13 serena-agent==${pinned}`,
    '  Enable:   "symbols": { "enabled": true }   in .detent/config.json',
    '  Silence:  "symbols": { "enabled": false }  — never mentioned again',
  ].join("\n");
}
