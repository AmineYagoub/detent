import { discover } from "../adapter/discover/index.js";
import { bindAll, acknowledgeSkip, type BindReport, type Skip } from "../adapter/bind.js";
import { writeBindings } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";
import type { GateSlot } from "../schemas/gates.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { createHash } from "node:crypto";
import type { Analysis } from "../schemas/init.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * T-064 — DETERMINE_VERIFICATION and auto-binding (C-3b, D-10, V-1).
 *
 * C-3b's rule in one line: **a lone plausible candidate is not a question.**
 * It is still executed (V-1 — an unexecuted binding is a guess, P4), but it
 * binds with provenance `approved_by: "auto"` and raises no interrupt. Only
 * three situations are worth a human's attention, and they are exactly the
 * three C-3b enumerates: two plausible candidates, a sole candidate that
 * cannot run, and no candidate at all where one is required.
 *
 * Greenfield binds `provisional` (C-4): there is nothing to bind against yet,
 * so the baseline is set later when bootstrap ticket #1's gates pass.
 */

/**
 * Which slots' absence is a setup situation rather than a skip.
 *
 * C-3b says an interrupt fires for "zero candidates **requiring a setup
 * action**" without saying which slots those are. This is the implementation's
 * reading: a project with no way to run tests cannot be gated at all — P2's
 * entire basis is exit codes — while a missing `e2e` or `build` is an ordinary
 * human-acknowledged skip (V-1). The gap is filed as PRDR-063; if the PRD
 * decides otherwise, this constant is the only thing that moves.
 */
export const SETUP_REQUIRED_SLOTS: readonly GateSlot[] = ["test"];

export interface DetermineDeps {
  readonly root: string;
  /** C-4: greenfield binds provisional; brownfield binds approved. */
  readonly greenfield: boolean;
  /** D-10: greenfield's stack decision — the only thing there is to bind to. */
  readonly analysis?: Analysis | null;
  readonly timeoutMs?: number;
  readonly acknowledgedBy?: string;
  readonly now?: () => string;
}

/**
 * Conventional gate commands per chosen stack. Used ONLY in greenfield, where
 * there is no tooling to discover yet — the stack was decided at ANALYZE, so
 * the bindings follow from that decision and bootstrap #1 proves them.
 *
 * Stack strings belong at this layer, not in the kernel: `init` is where a
 * stack is chosen, exactly as V-4 puts invocation knowledge in the adapter.
 */
const GREENFIELD_COMMANDS: Readonly<Record<string, Partial<Record<GateSlot, string>>>> = {
  typescript: { test: "npm run test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" },
  javascript: { test: "npm run test", lint: "npm run lint", build: "npm run build" },
  python: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
  go: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  rust: { test: "cargo test", typecheck: "cargo check", build: "cargo build" },
};

/**
 * C-4: greenfield bindings are recorded `provisional` at init — proposed from
 * the chosen stack, NOT executed, because the tooling they name does not
 * exist yet. That is precisely why they are provisional: bootstrap ticket #1
 * establishes the tooling and its passing gates set the drift baseline.
 *
 * V-1's execute-before-approve is not weakened here. It is deferred, and the
 * `provisional` status is the record that it has not happened yet.
 */
export function provisionalBindingsFor(analysis: Analysis | null, at: string): Binding[] {
  const language = analysis?.stack?.language.toLowerCase() ?? "";
  const commands = GREENFIELD_COMMANDS[language];
  if (commands === undefined) return [];
  return (Object.entries(commands) as [GateSlot, string][]).map(([slot, resolved]) => ({
    schema_version: SCHEMA_VERSION,
    slot,
    adapter: `greenfield:${language}`,
    ref: resolved,
    resolved,
    config_hash: createHash("sha256").update(`greenfield:${language}:${slot}:${resolved}`).digest("hex"),
    executed_at: at,
    approved_by: "auto",
    status: "provisional" as const,
  }));
}

export interface DetermineOutputs {
  readonly bindings: readonly Binding[];
  readonly skips: readonly Skip[];
  readonly status: Binding["status"];
}

export async function determineVerification(deps: DetermineDeps): Promise<PhaseOutcome> {
  const at = deps.now?.() ?? new Date().toISOString();

  /** ---- greenfield: propose from the chosen stack, do not execute (C-4) ---- */
  if (deps.greenfield) {
    const bindings = provisionalBindingsFor(deps.analysis ?? null, at);
    if (bindings.length === 0) {
      return {
        kind: "interrupt",
        interrupt: "AWAIT_SETUP_CONSENT",
        message: [
          "No conventional verification commands are known for the chosen stack,",
          "so Detent cannot propose even provisional bindings.",
          "",
          "Name the stack's test command in the planning documents and re-run `detent init`.",
        ].join("\n"),
        items: ["test"],
      };
    }
    writeBindings(deps.root, { bindings, skips: [] });
    return {
      kind: "complete",
      outputs: {
        bindings: bindings as unknown as Record<string, unknown>[],
        skips: [],
        status: "provisional",
      },
    };
  }

  const discovery = discover(deps.root);
  const status: Binding["status"] = "approved";

  const report: BindReport = await bindAll(discovery, {
    root: deps.root,
    status,
    /* C-3b's provenance for anything a human did not choose */
    approvedBy: "auto",
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  /** ---- C-3b interrupt 1: two plausible candidates — never a guess (V-1) ---- */
  const choices = report.interrupts.filter((i) => i.kind === "choice-required");
  if (choices.length > 0) {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_BINDING_CHOICE",
      message: [
        `Detent found more than one plausible verification command for ${choices.length} slot(s).`,
        ...choices.flatMap((c) =>
          c.kind === "choice-required"
            ? [`  ${c.slot}:`, ...c.candidates.map((cand, i) => `    ${i + 1}. ${cand.resolved}  (${cand.adapter})`)]
            : [],
        ),
        "",
        "Pick one per slot — Detent will not guess between them (V-1).",
      ].join("\n"),
      items: choices.map((c) => c.slot),
    };
  }

  /** ---- C-3b interrupt 2: the sole candidate could not be executed ---------- */
  const rejected = report.interrupts.filter((i) => i.kind === "rejected");
  if (rejected.length > 0) {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_SETUP_CONSENT",
      message: [
        "A verification command was found but could not be used:",
        ...rejected.map((r) => (r.kind === "rejected" ? `  ${r.slot}: ${r.explanation}` : "")),
      ].join("\n"),
      items: rejected.map((r) => r.slot),
    };
  }

  /** ---- C-3b interrupt 3: no candidate where one is required --------------- */
  const missingRequired = report.unbound.filter((slot) => SETUP_REQUIRED_SLOTS.includes(slot));
  if (missingRequired.length > 0) {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_SETUP_CONSENT",
      message: [
        `Detent found no way to run: ${missingRequired.join(", ")}.`,
        "",
        "A project with no test command cannot be gated — Detent trusts exit codes, not claims (P2).",
        "Establish the tooling (Detent can propose an allowlisted setup command), then re-run `detent init`.",
      ].join("\n"),
      items: missingRequired,
    };
  }

  /** Every remaining unbound slot is an ordinary acknowledged skip (V-1). */
  const skips = report.unbound
    .filter((slot) => !SETUP_REQUIRED_SLOTS.includes(slot))
    .map((slot) => acknowledgeSkip(slot, deps.acknowledgedBy ?? "auto", deps.now?.() ?? new Date().toISOString()));

  writeBindings(deps.root, { bindings: [...report.bindings], skips: [...skips] });

  return {
    kind: "complete",
    outputs: {
      bindings: report.bindings as unknown as Record<string, unknown>[],
      skips: skips as unknown as Record<string, unknown>[],
      status,
    },
  };
}

/** The PRESENT summary's binding table — provenance per slot (C-3b's AC). */
export function bindingTable(bindings: readonly Binding[], skips: readonly Skip[]): string {
  const rows = [
    ...bindings.map((b) => `  ${b.slot.padEnd(12)} ${b.resolved.padEnd(34)} ${b.status}, approved_by: ${b.approved_by}`),
    ...skips.map((s) => `  ${s.slot.padEnd(12)} ${"(skipped)".padEnd(34)} acknowledged_by: ${s.acknowledged_by}`),
  ];
  return rows.length === 0 ? "  (no verification bindings)" : rows.join("\n");
}
