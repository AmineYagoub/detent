import { DECISION_LOG_PATH } from "../schemas/pack.js";

/**
 * C-3⁗, C-2¹⁴ — what the specification phase leaves for the operator to judge
 * at approval: every default the plan follows, and beside them the risks
 * VALIDATE's last round left open.
 *
 * Both are calls a person may overrule, and both are made before planning, so
 * they are listed together and each says where it is overruled: a default in
 * its row of the decision log, a risk in the pack.
 */

export interface PresentedDefault {
  readonly id: string;
  readonly value: string;
  readonly reason: string;
}

/** A major the last round left open, as VALIDATE hands it on (PRDR-284). */
export interface PresentedRisk {
  readonly id: string;
  /** `file:line`, its first place. */
  readonly where: string;
  readonly fix: string;
  /** `unverified`, `declined` or `undone`. */
  readonly left: string;
  readonly reason: string;
}

export function specLines(defaults: readonly PresentedDefault[], risks: readonly PresentedRisk[]): string[] {
  const lines: string[] = [];
  if (defaults.length > 0) {
    lines.push("", `Defaults (${String(defaults.length)}) — the plan follows each; to veto one, edit its row in ${DECISION_LOG_PATH} and re-run \`detent init\` (C-3⁗):`);
    for (const d of defaults) {
      lines.push(`  ${d.id}: ${d.value}`);
      if (d.reason !== "") lines.push(`      because: ${d.reason}`);
    }
  }
  if (risks.length > 0) {
    lines.push(
      "",
      `Risks (${String(risks.length)}) — majors VALIDATE's last round left open; the plan proceeds, and to settle one, fix it in the pack and re-run \`detent init\` (C-2¹⁴):`,
    );
    for (const r of risks) {
      lines.push(`  ${r.id} ${r.where} (${r.left}): ${r.fix}`);
      if (r.reason !== "") lines.push(`      why: ${r.reason}`);
    }
  }
  return lines;
}
