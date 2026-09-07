import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { newTicket as buildTicket, writeTicket } from "../kernel/tickets/mutations.js";
import { claimBreakable, pidAlive, readClaim } from "../kernel/tickets/mutations.js";
import { hostname } from "node:os";
import { claimPath, ticketPath } from "../kernel/tickets/paths.js";
import { allTickets } from "../kernel/tickets/readers.js";
import type { Analysis, PlanDraftTicket, PlanReview, SliceSpec } from "../schemas/init.js";
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
    /**
     * A ticket's OWN edge into the earlier slice does not stand in for the
     * slice's order. The planner is told to name the specific ticket it needs,
     * so this is the commonest shape there is — and treating it as sufficient
     * let a later slice start against a slice that was one ticket in. Only the
     * capstone the ticket already names is skipped; the rest still gate it.
     */
    const dependedOn = new Set(theirs.flatMap((t) => t.depends_on));
    for (const t of theirs) {
      if (dependedOn.has(t.id) || ticket.depends_on.includes(t.id)) continue;
      out.push(t.id);
    }
  }
  return out;
}

export function writePlan(
  deps: WriteDeps,
  drafted: readonly DraftedTicket[],
  slices: readonly SliceSpec[],
): { readonly tickets: string[]; readonly bootstrap: string | null; readonly plan: Record<string, unknown>; readonly findings: PlanReview["findings"] } {
  const existing = allTickets(deps.root);
  const done = new Map(existing.filter((t) => t.state === "DONE").map((t) => [t.id, t]));
  const findings: PlanReview["findings"] = [];

  /**
   * C-8″ (PRDR-118): everything is decided in memory and validated BEFORE a
   * byte moves. This function used to create every ticket, delete every
   * orphan, and only then parse the plan artifact — so a plan the schema
   * refused left the directory rewritten and `plan.json` missing, with no way
   * back but hand-editing. Decide, validate, then write.
   */
  const planned: Ticket[] = [];

  /** ---- C-4: greenfield gets bootstrap #1, and everything blocks on it ------ */
  if (deps.greenfield) {
    /**
     * A DONE bootstrap is finished scaffolding, and re-creating it reset it to
     * READY with its generations wiped — then blocked the whole plan behind
     * rebuilding a project that already exists.
     */
    const finished = done.get(BOOTSTRAP_TICKET_ID);
    if (finished === undefined) {
      planned.push(bootstrapTicket(deps));
      deps.note?.(`bootstrap ticket ${BOOTSTRAP_TICKET_ID} created; every other ticket is blocked on it (C-4)`);
    } else {
      planned.push(finished);
      deps.note?.(`${BOOTSTRAP_TICKET_ID} is DONE — preserved, not re-created (C-4/PRDR-085)`);
    }
  }

  /**
   * PRDR-085: DONE work is not re-planned. Its code is committed and its
   * record is real; a redraft reusing the id would reset it to READY and send
   * a session to rebuild what already exists.
   */
  for (const draft of drafted) {
    const finished = done.get(draft.id);
    if (finished !== undefined) {
      deps.note?.(`${draft.id} is DONE — preserved, not re-planned (PRDR-085)`);
      /**
       * Ids are positional (`t-<slice>-NNN`), so a renumbered slice reuses
       * them by default. When the preserved work is not what the plan now says
       * that id means, the human is the only one who can tell whether the
       * requirement is finished or was silently dropped.
       */
      if (finished.title !== draft.title) {
        findings.push({
          tag: "traceability",
          ticket: draft.id,
          finding: `the plan drafts this id as "${draft.title}" but a DONE ticket already holds it as "${finished.title}" — the DONE work was kept and the drafted work is NOT in the plan`,
        });
        deps.note?.(`${draft.id}: DONE as "${finished.title}", drafted as "${draft.title}" — kept the DONE ticket, flagged for you`);
      }
      planned.push(finished);
      continue;
    }
    const ordering = capstoneBlockers(draft, slices, drafted);
    planned.push(
      newTicket(deps, draft, [...new Set([...(deps.greenfield ? [BOOTSTRAP_TICKET_ID] : []), ...draft.depends_on, ...ordering])]),
    );
  }

  /**
   * A preserved DONE ticket carries the blockers of the plan that created it,
   * and the new plan may not name them. The edge would fail `planSchema` after
   * every ticket had already been rewritten; the work is finished, so the
   * stale edge is dropped rather than the plan.
   */
  const ids = new Set(planned.map((t) => t.id));
  const settled = planned.map((t) => {
    const live = t.blockers.filter((b) => ids.has(b));
    if (live.length === t.blockers.length) return t;
    deps.note?.(`${t.id}: dropped blocker(s) ${t.blockers.filter((b) => !ids.has(b)).join(", ")} — the new plan does not contain them`);
    return { ...t, blockers: live };
  });

  /** ---- A-2: the plan artifact, validated before anything is written ------ */
  const plan: Plan = planSchema.parse({
    schema_version: 1,
    tickets: settled.map((t) => t.id),
    edges: settled.flatMap((t) => t.blockers.map((b) => ({ from: b, to: t.id }))),
    /* PREPARE_AGENTS fills these (T-067) */
    assignments: {},
    input_doc_hashes: Object.fromEntries(deps.docs.map((doc) => [doc, hashFile(path.join(deps.root, ...doc.split("/")))])),
    /** C-2‴: the increments the plan was planned in, for the presentation and the report. */
    slices: slices.map((s) => ({ id: s.id, title: s.title, tickets: drafted.filter((t) => t.slice === s.id).map((t) => t.id) })),
  });
  /**
   * C-9′ (PRDR-153): the live-claim check belongs HERE, before anything is
   * written. PRDR-139 put it in the orphan sweep — after every ticket had
   * already been rewritten — so the throw left the directory reset, the orphans
   * present and `plan.json` stale: exactly the half-written state this file's
   * own header says it was restructured to prevent ("Decide, validate, then
   * write", PRDR-118).
   *
   * It also covers RETAINED tickets, which the sweep never reached. A claimed
   * ticket the new plan keeps is overwritten by a freshly built `newTicket` —
   * state READY, generations wiped — while its session runs on. The lock
   * surviving is no comfort if the state it protects is rewound.
   */
  for (const current of existing) {
    if (current.state === "DONE") continue;
    const held = readClaim(deps.root, current.id);
    if (held !== null && !claimBreakable(held, pidAlive, hostname())) {
      throw new Error(
        `${current.id} is claimed by a live process (pid ${held.pid} on ${held.host}) — stop the run before re-planning. ` +
          "Re-planning rewrites a ticket's state and generations, and removing one deletes its lock (C-9/R-3).",
      );
    }
  }

  /** ---- everything validated: now the directory may change ---------------- */
  for (const ticket of settled) {
    const preserved = done.get(ticket.id);
    /**
     * A preserved ticket is rewritten only when its blockers were pruned, so
     * the file and the plan artifact agree; its state, generations and notes
     * are the object read from disk and are carried through untouched.
     */
    if (preserved === undefined || preserved.blockers.length !== ticket.blockers.length) writeTicket(deps.root, ticket);
  }

  /**
   * PRDR-085: tickets the new plan does not name are orphans — a replan that
   * shrinks 32 tickets to 15 used to leave the other 17 on disk, READY and
   * claimable, so `run` would build work no plan asked for. DONE tickets are
   * never orphans: they are carried above and their record stands.
   */
  for (const stale of existing) {
    if (ids.has(stale.id) || stale.state === "DONE") continue;
    /* Live claims were refused above, before anything was written. */
    rmSync(ticketPath(deps.root, stale.id), { force: true });
    rmSync(claimPath(deps.root, stale.id), { force: true });
    deps.note?.(`${stale.id} removed — the new plan does not contain it (PRDR-085)`);
  }

  writeFileSync(planFile(deps.root), `${JSON.stringify(plan, null, 2)}\n`);

  return {
    tickets: settled.map((t) => t.id),
    bootstrap: deps.greenfield ? BOOTSTRAP_TICKET_ID : null,
    plan: plan as unknown as Record<string, unknown>,
    findings,
  };
}

/**
 * C-4's bootstrap ticket, constructed rather than drafted. Its criteria name
 * every slot that bound, because "prove every bound slot executes green" is
 * the ticket's actual job — and F-2 is stated in its non-goals so the session
 * working it cannot mistake `.detent/` for a place project config may live.
 */
function bootstrapTicket(deps: WriteDeps): Ticket {
  const stack = deps.analysis?.stack;
  const slots = deps.boundSlots.length > 0 ? deps.boundSlots : ["test"];
  return buildTicket({
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

/** A drafted ticket, built in memory. Writing is the caller's, after validation. */
function newTicket(deps: WriteDeps, draft: DraftedTicket, blockers: readonly string[]): Ticket {
  void deps;
  return buildTicket({
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
    blockers: [...blockers],
    /** A-1‴: the interface travels with the ticket — the sessions read it. */
    provides: draft.provides,
    consumes: draft.consumes,
    risk_label: draft.risk_label,
  });
}

