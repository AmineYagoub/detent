import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { createTicket } from "../kernel/tickets/mutations.js";
import { ticketPath } from "../kernel/tickets/paths.js";
import { allTickets, readTicket } from "../kernel/tickets/readers.js";
import type { Analysis, PlanDraftTicket, SliceSpec } from "../schemas/init.js";
import { planSchema, type Plan } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";

/**
 * The write half of PLAN (C-4, A-2, C-2‴): drafted tickets become A-1
 * tickets on disk, the bootstrap ticket first, slice order enforced through
 * blockers, DONE work preserved (PRDR-085), orphans removed, and the A-2 plan
 * artifact written with the slices it was planned in.
 */

export const BOOTSTRAP_TICKET_ID = "t-001-bootstrap";

/** A drafted ticket, tagged with the slice that drafted it. */
export type DraftedTicket = PlanDraftTicket & { readonly slice: string };

export interface WriteDeps {
  readonly root: string;
  readonly greenfield: boolean;
  readonly analysis: Analysis | null;
  readonly docs: readonly string[];
  readonly boundSlots: readonly string[];
  readonly note?: (text: string) => void;
}

function planFile(root: string): string {
  return path.join(stateDir(root), "plan", "plan.json");
}

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * C-2‴: a slice's tickets cannot start before the slices it thickens are
 * done. A ticket with no dependency of its own into an earlier slice gets
 * that slice's CAPSTONES — the tickets nothing else in the slice depends on —
 * as blockers, so order holds without serialising work inside a slice.
 */
export function capstoneBlockers(ticket: DraftedTicket, slices: readonly SliceSpec[], all: readonly DraftedTicket[]): string[] {
  const own = slices.find((s) => s.id === ticket.slice);
  if (own === undefined) return [];
  const out: string[] = [];
  for (const dep of own.depends_on) {
    const theirs = all.filter((t) => t.slice === dep);
    if (theirs.length === 0) continue;
    const alreadyLinked = ticket.depends_on.some((d) => theirs.some((t) => t.id === d));
    if (alreadyLinked) continue;
    const dependedOn = new Set(theirs.flatMap((t) => t.depends_on));
    for (const t of theirs) if (!dependedOn.has(t.id)) out.push(t.id);
  }
  return out;
}

export function writePlan(
  deps: WriteDeps,
  drafted: readonly DraftedTicket[],
  slices: readonly SliceSpec[],
): { readonly tickets: string[]; readonly bootstrap: string | null; readonly plan: Record<string, unknown> } {
  /** ---- C-4: greenfield gets bootstrap #1, and everything blocks on it ------ */
  const written: Ticket[] = [];
  if (deps.greenfield) {
    written.push(createBootstrapTicket(deps));
    deps.note?.(`bootstrap ticket ${BOOTSTRAP_TICKET_ID} created; every other ticket is blocked on it (C-4)`);
  }

  /**
   * PRDR-085: DONE work is not re-planned. Its code is committed and its
   * record is real; a redraft reusing the id would reset it to READY and send
   * a session to rebuild what already exists.
   */
  const done = new Set(allTickets(deps.root).filter((t) => t.state === "DONE").map((t) => t.id));
  for (const draft of drafted) {
    if (done.has(draft.id)) {
      deps.note?.(`${draft.id} is DONE — preserved, not re-planned (PRDR-085)`);
      written.push(readTicket(deps.root, draft.id));
      continue;
    }
    const ordering = capstoneBlockers(draft, slices, drafted);
    const blockers = [...new Set([...(deps.greenfield ? [BOOTSTRAP_TICKET_ID] : []), ...draft.depends_on, ...ordering])];
    written.push(
      createTicket(deps.root, {
        id: draft.id,
        type: draft.type,
        title: draft.title,
        description: draft.description,
        acceptance_criteria: draft.acceptance_criteria,
        /**
         * PRDR-101: the draft always carried `non_goals` and this call did not
         * copy it, so the schema defaulted it to `[]` and every ticket in every
         * plan reached the implementer and the reviewer with its boundaries
         * stripped. Silent, because an empty list is legal.
         */
        non_goals: draft.non_goals,
        surface: draft.surface,
        blockers,
        risk_label: draft.risk_label,
      }),
    );
  }

  /**
   * PRDR-085: tickets the new plan does not name are orphans — a replan that
   * shrinks 32 tickets to 15 used to leave the other 17 on disk, READY and
   * claimable, so `run` would build work no plan asked for. DONE tickets are
   * never orphans: they are carried above and their record stands.
   */
  const planned = new Set(written.map((t) => t.id));
  for (const existing of allTickets(deps.root)) {
    if (planned.has(existing.id) || existing.state === "DONE") continue;
    rmSync(ticketPath(deps.root, existing.id), { force: true });
    deps.note?.(`${existing.id} removed — the new plan does not contain it (PRDR-085)`);
  }

  /** ---- A-2: the plan artifact ------------------------------------------- */
  const plan: Plan = planSchema.parse({
    schema_version: 1,
    tickets: written.map((t) => t.id),
    edges: written.flatMap((t) => t.blockers.map((b) => ({ from: b, to: t.id }))),
    /* PREPARE_AGENTS fills these (T-067) */
    assignments: {},
    input_doc_hashes: Object.fromEntries(deps.docs.map((doc) => [doc, hashFile(path.join(deps.root, ...doc.split("/")))])),
    /** C-2‴: the increments the plan was planned in, for the presentation and the report. */
    slices: slices.map((s) => ({ id: s.id, title: s.title, tickets: drafted.filter((t) => t.slice === s.id).map((t) => t.id) })),
  });
  writeFileSync(planFile(deps.root), `${JSON.stringify(plan, null, 2)}\n`);

  return {
    tickets: written.map((t) => t.id),
    bootstrap: deps.greenfield ? BOOTSTRAP_TICKET_ID : null,
    plan: plan as unknown as Record<string, unknown>,
  };
}

/**
 * C-4's bootstrap ticket, constructed rather than drafted. Its criteria name
 * every slot that bound, because "prove every bound slot executes green" is
 * the ticket's actual job — and F-2 is stated in its non-goals so the session
 * working it cannot mistake `.detent/` for a place project config may live.
 */
function createBootstrapTicket(deps: WriteDeps): Ticket {
  const stack = deps.analysis?.stack;
  const slots = deps.boundSlots.length > 0 ? deps.boundSlots : ["test"];
  return createTicket(deps.root, {
    id: BOOTSTRAP_TICKET_ID,
    type: "feature",
    title: "Bootstrap: project scaffolding and native verification tooling",
    description: [
      "Create the project scaffolding and establish its native verification tooling.",
      stack === undefined || stack === null
        ? ""
        : `Stack chosen at ANALYZE: ${stack.language}${stack.runtime === "" ? "" : ` on ${stack.runtime}`}` +
          `${stack.test_framework === "" ? "" : `, tested with ${stack.test_framework}`}. ${stack.rationale}`,
      "",
      "Configuration you create here is ticket work product, reviewed as code (C-4) — it lives in project files, never in `.detent/` (F-2).",
    ]
      .filter((l) => l !== "")
      .join("\n"),
    acceptance_criteria: [
      "The project's own verification commands exist in project files (not `.detent/`).",
      ...slots.map((slot) => `The \`${slot}\` gate runs and exits 0.`),
      "A reader can run the project's tests from a fresh clone using only its native tooling.",
    ],
    non_goals: [
      "Detent's own state directory `.detent/` holds no project configuration (F-2).",
      "No feature work — this ticket establishes the ground the other tickets stand on.",
    ],
    /* scaffolding necessarily touches the whole tree */
    surface: ["**"],
    /* claimed first */
    priority: 100,
  });
}

