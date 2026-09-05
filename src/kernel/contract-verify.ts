import type { Ticket } from "../schemas/ticket.js";

/**
 * A-1⁗ (PRDR-121) — did the ticket build the interface it said it would?
 *
 * A ticket declares it provides `controlplane/internal/v1.TerminalStates`
 * (A-1‴) and, until now, nothing checked. The precise answer is a symbol-table
 * lookup, which needs the optional adapter and an MCP client Detent does not
 * have. The cheap answer needs neither and catches the case that actually
 * happens: the ticket claimed a name and the identifier appears nowhere in
 * what it changed.
 *
 * Searching the rendered DIFF rather than the files is the stronger question:
 * a file may already contain the name for unrelated reasons, but the diff is
 * what this ticket did.
 *
 * Deliberately weak in one direction and never the other. An identifier in a
 * comment would satisfy it, so it does not fail the ticket and never touches
 * the gate — it is EVIDENCE handed to the review, which was already judging
 * whether the diff does what the ticket says. A false positive is a sentence a
 * reviewer reads and dismisses, not a red build.
 */

/** The part of a contract id that must appear in the code: the last dotted segment. */
export function identifierOf(contractId: string): string {
  const tail = contractId.split("/").pop() ?? contractId;
  return (tail.split(".").pop() ?? tail).trim();
}

/** Declared `symbol:` provides whose identifier appears nowhere in the diff. */
export function unverifiedProvides(ticket: Ticket, diff: string): string[] {
  if (diff === "") return [];
  return ticket.provides
    .filter((p) => p.kind === "symbol")
    .filter((p) => {
      const name = identifierOf(p.id);
      if (name === "") return false;
      return !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(diff);
    })
    .map((p) => p.id);
}

/** What the review is told, when there is anything to tell it. */
export function contractEvidence(ticket: Ticket, diff: string): Record<string, unknown> {
  const missing = unverifiedProvides(ticket, diff);
  if (missing.length === 0) return {};
  return {
    unverified_provides: missing,
    contract_instruction:
      "This ticket declared it PROVIDES the names above, and Detent could not find their identifiers anywhere in this " +
      "diff. Another ticket's work depends on them existing. Treat it as evidence, not proof — a name may be spelled " +
      "differently or generated — and judge whether the interface the ticket promised is actually there.",
  };
}
