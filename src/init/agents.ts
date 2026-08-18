import { writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { assignmentsFileSchema } from "../schemas/records.js";
import type { RoleId } from "../schemas/roles.js";
import type { Ticket } from "../schemas/ticket.js";
import { resolveAssignment, type PromptSet } from "../sessions/prompts.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * T-067 — PREPARE_AGENTS (S-7, D-9, SEC-2).
 *
 * Selection from the **vendored set only**. Every assignment is written as
 * `role@hash` and verified against the loaded prompt manifest before the file
 * is written, so an assignment naming an unknown role or a hash that does not
 * match what shipped fails closed here rather than at runtime, mid-ticket.
 *
 * No network, ever: the prompt set is a parameter, and nothing in this phase
 * can fetch one (SEC-2/NG6). The assignment names the role that *opens* the
 * ticket — `diagnose` for a bug, `implement` for a feature — because X-3
 * fixes every role after that.
 */

export function assignmentsPath(root: string): string {
  return path.join(stateDir(root), "agents", "assignments.json");
}

/** X-3's opening role: a bug ticket is diagnosed before it is implemented. */
export function openingRole(ticket: Pick<Ticket, "type">): RoleId {
  return ticket.type === "bug" ? "diagnose" : "implement";
}

export interface PrepareAgentsDeps {
  readonly root: string;
  readonly tickets: readonly Ticket[];
  readonly prompts: PromptSet;
  readonly note?: (text: string) => void;
}

export function prepareAgents(deps: PrepareAgentsDeps): PhaseOutcome {
  const assignments: Record<string, string> = {};
  for (const ticket of deps.tickets) {
    const role = openingRole(ticket);
    const hash = deps.prompts.hashes[role];
    const ref = `${role}@${hash}`;
    /**
     * Fail closed BEFORE writing: resolveAssignment throws on an unknown role
     * or a hash that does not match the vendored set (S-7's AC).
     */
    resolveAssignment(ref, deps.prompts);
    assignments[ticket.id] = ref;
  }

  const file = assignmentsFileSchema.parse({ schema_version: 1, assignments });
  writeFileSync(assignmentsPath(deps.root), `${JSON.stringify(file, null, 2)}\n`);
  deps.note?.(`assigned ${Object.keys(assignments).length} ticket(s) from the vendored role set (S-7)`);

  return { kind: "complete", outputs: { assignments } };
}
