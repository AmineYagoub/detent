import { createHash } from "node:crypto";
import type { Budgets } from "../schemas/budgets.js";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { planDraftSchema, type Analysis, type PlanDraftTicket, type PlanReview } from "../schemas/init.js";
import { PLAN_REVISIONS, reviewPlan, sessionBudget } from "./plan-review.js";
import { planSchema, type Binding, type Plan } from "../schemas/records.js";
import { createTicket } from "../kernel/tickets/mutations.js";
import { allTickets, readTicket } from "../kernel/tickets/readers.js";
import { ticketPath } from "../kernel/tickets/paths.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * T-066 — PLAN generation and the bootstrap lifecycle (C-4, A-2).
 *
 * The planner drafts feature tickets; **Detent constructs the bootstrap
 * ticket itself**. That division is C-4's, and it matters: bootstrap #1 must
 * establish the project's native verification tooling and *prove every bound
 * slot executes green*, and a planner that forgot it — or wrote criteria that
 * did not actually prove it — would produce a plan whose whole foundation is
 * unverified. So the ticket is a fixed construction, its criteria derived
 * from the bindings that exist, and every other ticket is blocked on it.
 *
 * Greenfield bindings stay `provisional` until #1's gates pass; the flip to
 * `approved` (with baseline hashes) happens in the run loop when #1 reaches
 * DONE — see `finalizeBootstrap`.
 */

/**
 * PRDR-101's structural half: the draft-to-ticket mapping below is hand-written,
 * and `non_goals` went unhandled for the life of the pipeline because an
 * unmapped field does not fail — the ticket schema simply defaults it. Nothing
 * catches that, least of all the suite: the shared draft fixture writes
 * `non_goals: []`, which cannot distinguish dropped from honestly empty.
 *
 * So the mapping is made total at COMPILE time. Every key of a drafted ticket
 * must appear in `MappedDraftKeys`; adding a field to `planDraftSchema` without
 * listing it here is a type error rather than a silent default. The list is
 * still written by hand — but now it is checked against the schema, which is
 * the part that was missing.
 */
type MappedDraftKeys =
  | "id"
  | "type"
  | "title"
  | "description"
  | "acceptance_criteria"
  | "non_goals"
  | "surface"
  | "depends_on"
  | "risk_label";
type UnmappedDraftKeys = Exclude<keyof PlanDraftTicket, MappedDraftKeys>;
/** Fails to compile the moment a drafted field is left unhandled. */
const DRAFT_MAPPING_IS_TOTAL: UnmappedDraftKeys extends never ? true : never = true;
void DRAFT_MAPPING_IS_TOTAL;

export const BOOTSTRAP_TICKET_ID = "t-001-bootstrap";

export function planDraftPath(root: string): string {
  return path.join(stateDir(root), "state", "plan-draft.json");
}

export function planPath(root: string): string {
  return path.join(stateDir(root), "plan", "plan.json");
}

export interface PlanDeps {
  readonly root: string;
  readonly greenfield: boolean;
  readonly analysis: Analysis | null;
  /** Repo-relative docs the plan derives from — hashed into A-2 (C-8). */
  readonly docs: readonly string[];
  /** Slots that actually bound, for the bootstrap ticket's criteria. */
  readonly boundSlots: readonly string[];
  /** PRDR-081: the budget a ticket must fit — the planner sizes against it. */
  readonly budgets: Budgets;
  /** PRDR-084: the artifact path is per-launch — PLAN writes a draft, REVIEW_PLAN a verdict. */
  readonly launch: (inputs: Record<string, unknown>, artifactOut?: string) => Promise<void>;
  readonly note?: (text: string) => void;
}

/**
 * The EXACT artifact shape PLAN must write (PRDR-067's sibling lesson from
 * T-140: prose contracts drift; `expected_output` plus a strict validator
 * does not). A test parses this skeleton through `planDraftSchema`.
 */
export function planDraftSkeleton(): Record<string, unknown> {
  return {
    schema_version: 1,
    tickets: [
      {
        id: "t-100",
        type: "feature",
        title: "<short imperative title — required>",
        description: "<what and why — may be empty>",
        acceptance_criteria: ["<testable criterion — at least one, non-empty>"],
        non_goals: ["<explicitly out of scope — may be empty list>"],
        surface: ["src/**", "tests/**"],
        depends_on: [],
        risk_label: false,
      },
    ],
  };
}

/** One drafting launch. Called again with findings when the review asks (PRDR-084). */
async function draftPlan(deps: PlanDeps, findings?: PlanReview["findings"]): Promise<void> {
  /* A re-run derives fresh (C-8); a stale draft is an echo chamber, not an input. */
  rmSync(planDraftPath(deps.root), { force: true });

  await deps.launch({
    stage: "PLAN",
    analysis: deps.analysis,
    docs: deps.docs,
    greenfield: deps.greenfield,
    bound_slots: deps.boundSlots,
    /**
     * PRDR-081: the planner sizes tickets against the budget that will
     * actually execute them. Without it the plan mirrors its documents'
     * altitude — a PRD in, PRD-sized epics out, each far past what one
     * session can finish or a gate can verify.
     */
    session_budget: sessionBudget(deps.budgets),
    ...(findings === undefined ? {} : { review_findings: findings }),
    expected_output: planDraftSkeleton(),
    instruction: `${
      deps.greenfield
        ? "Draft the feature tickets. Do NOT draft a scaffolding or setup ticket — Detent adds the bootstrap ticket itself and blocks everything on it."
        : "Draft the tickets. Each needs non-empty, testable acceptance criteria and an explicit surface."
    } Size every ticket to ONE implement session inside \`session_budget\`, and order the plan as vertical slices (walking skeleton first), never as infrastructure layers completed ahead of the first end-to-end path. Write EXACTLY the \`expected_output\` shape to artifact_out — a top-level object with \`schema_version\` and \`tickets\` only; the validator is strict and refuses unknown keys (P2).${
      findings === undefined ? "" : " A previous draft drew the `review_findings` in your inputs — address every one of them in this draft."
    }`,
  });
}

export async function planStage(deps: PlanDeps): Promise<PhaseOutcome> {
  await draftPlan(deps);
  let drafted = readValidatedDraft(deps.root);

  /**
   * PRDR-084 — the plan's own D-6. A fresh session judges the draft against
   * the five properties a plan can be wrong about; a `changes` verdict buys
   * exactly one revision (see PLAN_REVISIONS), and whatever the reviewer still
   * faults after that rides to PRESENT as a note for the human, rather than
   * the machine grinding on a judgment call.
   */
  const review = await reviewPlan(deps, drafted);
  if (review === null) {
    deps.note?.("plan review produced no artifact — the draft stands unreviewed (PRDR-084)");
  } else if (review.verdict === "changes" && review.findings.length > 0) {
    deps.note?.(`plan review: ${review.findings.length} finding(s) — ${review.findings.map((f) => f.tag).join(", ")}`);
    for (let round = 0; round < PLAN_REVISIONS; round += 1) {
      await draftPlan(deps, review.findings);
      drafted = readValidatedDraft(deps.root);
    }
    const second = await reviewPlan(deps, drafted);
    if (second !== null && second.verdict === "changes" && second.findings.length > 0) {
      deps.note?.(
        `plan review after revision: ${second.findings.length} finding(s) remain — ` +
          `${second.findings.map((f) => `${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}`).join("; ")}`,
      );
    } else {
      deps.note?.("plan review: revision accepted");
    }
  } else {
    deps.note?.("plan review: approve");
  }

  const ids = new Set(drafted.map((t) => t.id));
  if (ids.size !== drafted.length) throw new Error("PLAN drafted duplicate ticket ids");
  if (ids.has(BOOTSTRAP_TICKET_ID)) throw new Error(`PLAN drafted ${BOOTSTRAP_TICKET_ID}; the bootstrap ticket is Detent's (C-4)`);
  for (const ticket of drafted) {
    for (const dep of ticket.depends_on) {
      if (!ids.has(dep)) throw new Error(`ticket ${ticket.id} depends on unknown ticket ${dep}`);
    }
  }

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
    const blockers = deps.greenfield ? [BOOTSTRAP_TICKET_ID, ...draft.depends_on] : [...draft.depends_on];
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
    input_doc_hashes: Object.fromEntries(
      deps.docs.map((doc) => [doc, hashFile(path.join(deps.root, ...doc.split("/")))]),
    ),
  });
  writeFileSync(planPath(deps.root), `${JSON.stringify(plan, null, 2)}\n`);

  return {
    kind: "complete",
    outputs: {
      tickets: written.map((t) => t.id),
      bootstrap: deps.greenfield ? BOOTSTRAP_TICKET_ID : null,
      plan: plan as unknown as Record<string, unknown>,
    },
  };
}

/**
 * C-4's bootstrap ticket, constructed rather than drafted. Its criteria name
 * every slot that bound, because "prove every bound slot executes green" is
 * the ticket's actual job — and F-2 is stated in its non-goals so the session
 * working it cannot mistake `.detent/` for a place project config may live.
 */
function createBootstrapTicket(deps: PlanDeps): Ticket {
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

/*
 * ---------------------------------------------------------------------------
 * The other half of C-4: finalization when bootstrap #1 goes DONE
 */

/**
 * C-4: "Greenfield bindings are recorded `provisional` at init and finalized —
 * drift baseline set — when ticket #1's gates pass." Called by the run loop
 * the moment the bootstrap ticket reaches DONE; a no-op for every other
 * ticket, and idempotent.
 *
 * Finalization RE-DISCOVERS rather than looking the provisional binding up by
 * its own adapter. A greenfield binding was proposed from the chosen stack
 * (`greenfield:typescript`) and never discovered, because the tooling did not
 * exist; bootstrap #1 has just created it, so the real binding — with the
 * real config region that V-3 will watch — is what discovery finds NOW. The
 * slot is the only thing carried across.
 */
export function finalizeBootstrap(
  root: string,
  ticketId: string,
  deps: {
    readonly readBindings: () => { bindings: readonly Binding[]; skips: readonly unknown[] };
    readonly writeBindings: (file: { bindings: Binding[]; skips: unknown[] }) => void;
    /** Candidates discoverable now, after bootstrap created the tooling. */
    readonly rediscover: () => readonly {
      slot: string;
      adapter: string;
      ref: string;
      resolved: string;
      config_hash: string;
      pm: string | null;
    }[];
    readonly now?: () => string;
    readonly note?: (text: string) => void;
  },
): boolean {
  if (ticketId !== BOOTSTRAP_TICKET_ID) return false;
  const file = deps.readBindings();
  const provisional = file.bindings.filter((b) => b.status === "provisional");
  if (provisional.length === 0) return false;

  const candidates = deps.rediscover();
  const at = deps.now?.() ?? new Date().toISOString();
  const finalized: Binding[] = [];
  const unresolved: string[] = [];

  for (const binding of file.bindings) {
    if (binding.status !== "provisional") {
      finalized.push(binding);
      continue;
    }
    const now = candidates.find((c) => c.slot === binding.slot);
    if (now === undefined) {
      /*
       * Bootstrap's gates passed, so SOMETHING ran — but nothing discoverable
       * backs this slot. Keeping it provisional is the honest record: an
       * approved binding with no config region has no baseline to drift from.
       */
      unresolved.push(binding.slot);
      finalized.push(binding);
      continue;
    }
    finalized.push({
      ...binding,
      adapter: now.adapter,
      ref: now.ref,
      resolved: now.resolved,
      config_hash: now.config_hash,
      ...(now.pm === null ? {} : { pm: now.pm }),
      executed_at: at,
      status: "approved",
    });
  }

  deps.writeBindings({ bindings: finalized, skips: [...file.skips] });
  const promoted = provisional.length - unresolved.length;
  deps.note?.(
    `bootstrap complete: ${promoted} provisional binding(s) finalized with drift baselines (C-4)${ 
      unresolved.length === 0 ? "" : `; ${unresolved.join(", ")} stayed provisional — nothing discoverable backs them`}`,
  );
  return true;
}

/** Whether a ticket is claimable given C-4's bootstrap blocking. */
export function bootstrapBlocks(root: string, ticketId: string): boolean {
  if (ticketId === BOOTSTRAP_TICKET_ID) return false;
  if (!existsSync(path.join(stateDir(root), "plan", `${BOOTSTRAP_TICKET_ID}.json`))) return false;
  return readTicket(root, BOOTSTRAP_TICKET_ID).state !== "DONE";
}

function readValidatedDraft(root: string): PlanDraftTicket[] {
  const raw = readDraft(root);
  const parsed = raw === null ? null : parseArtifact(planDraftSchema, raw);
  if (parsed === null || !parsed.ok) {
    throw new Error(
      parsed === null
        ? "PLAN produced no draft artifact"
        : `PLAN produced an invalid draft: ${parsed.reason === "invalid" ? parsed.issues.join("; ") : "newer schema"}`,
    );
  }
  return [...parsed.value.tickets];
}

function readDraft(root: string): unknown {
  return readJson(planDraftPath(root));
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hashFile(abs: string): string {
  if (!existsSync(abs)) return createHash("sha256").update("").digest("hex");
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

