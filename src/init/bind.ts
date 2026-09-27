import { discover } from "../adapter/discover/index.js";
import { probeSymbols, symbolsSetupMessage, type SymbolsConfig } from "../adapter/symbols.js";
import { bindAll, acknowledgeSkip, type BindReport, type Skip } from "../adapter/bind.js";
import { writeBindings } from "../adapter/drift.js";
import type { Binding } from "../schemas/records.js";
import type { GateSlot } from "../schemas/gates.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { createHash } from "node:crypto";
import type { DecidedStack } from "./decide-log.js";
import type { PhaseOutcome } from "./machine.js";
import { scrub } from "../kernel/scrub.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";

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
  /** S-3⁸: optional symbol intelligence; absent or disabled, this phase ignores it. */
  readonly symbols?: SymbolsConfig;
  readonly root: string;
  /** C-4: greenfield binds provisional; brownfield binds approved. */
  readonly greenfield: boolean;
  /**
   * D-10′ (PRDR-290): greenfield's stack, the entry the decision log records
   * and the pack carries: the only thing there is to bind to. Null where the
   * log records none.
   */
  readonly stack?: DecidedStack | null;
  readonly timeoutMs?: number;
  readonly acknowledgedBy?: string;
  readonly now?: () => string;
  /** V-1‴ (PRDR-155): where a bound gate that may verify nothing is said. */
  readonly note?: (text: string) => void;
}

/**
 * Conventional gate commands per chosen stack. Used ONLY in greenfield, where
 * there is no tooling to discover yet — the stack was decided at DECIDE
 * (D-10′), so the bindings follow from that decision and bootstrap #1 proves
 * them.
 *
 * Stack strings belong at this layer, not in the kernel: `init` is where a
 * stack is chosen, exactly as V-4 puts invocation knowledge in the adapter.
 */
export const GREENFIELD_COMMANDS: Readonly<Record<string, Partial<Record<GateSlot, string>>>> = {
  typescript: { test: "npm run test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" },
  javascript: { test: "npm run test", lint: "npm run lint", build: "npm run build" },
  python: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
  go: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  rust: { test: "cargo test", typecheck: "cargo check", build: "cargo build" },
  java: { test: "mvn -q test", build: "mvn -q -DskipTests package" },
  ruby: { test: "bundle exec rake test" },
  dotnet: { test: "dotnet test", lint: "dotnet format --verify-no-changes", build: "dotnet build" },
  php: { test: "composer test" },
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
/**
 * PRDR-115: the planner writes `stack.language` as prose as readily as a
 * name — "Go 1.27 (multi-module monorepo: …)" matched nothing and init
 * refused a stack it had a table row for. The key is the first known
 * language named as a WORD in the string; an exact match still wins.
 */
const LANGUAGE_WORDS: readonly (readonly [string, RegExp])[] = [
  ["typescript", /\btypescript\b|\bts\b/i],
  ["javascript", /\bjavascript\b|\bnode(?:\.js)?\b/i],
  ["python", /\bpython\b/i],
  ["go", /\bgo(?:lang)?\b/i],
  ["rust", /\brust\b|\bcargo\b/i],
  ["java", /\bjava\b|\bkotlin\b|\bmaven\b|\bjvm\b/i],
  ["ruby", /\bruby\b|\brails\b/i],
  ["dotnet", /\b(?:dotnet|\.net|c#|csharp)\b/i],
  ["php", /\bphp\b|\blaravel\b|\bsymfony\b/i],
];

export function languageKey(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (lower in GREENFIELD_COMMANDS) return lower;
  for (const [key, pattern] of LANGUAGE_WORDS) if (pattern.test(raw)) return key;
  return null;
}

function provisionalBindingsFor(stack: DecidedStack, at: string): Binding[] {
  const key = languageKey(stack.language);
  /*
   * PRDR-115: commands the documents name are the bindings — the table is
   * only for documents that name none. A stack table cannot know a project's
   * own gates; ksar's D44 named all three and init still refused them.
   *
   * D-10′ (PRDR-290): the entry holds them by slot, as the root package's
   * rows under `## Packages`, where ANALYZE copied five slots out of prose;
   * `test_single` is one of the entry's, so it binds too.
   */
  const documented = Object.entries(stack.gates).filter((e): e is [GateSlot, string] => typeof e[1] === "string" && e[1] !== "");
  const commands: [GateSlot, string][] =
    documented.some(([slot]) => slot === "test")
      ? documented
      : key === null
        ? []
        : (Object.entries(GREENFIELD_COMMANDS[key] ?? {}) as [GateSlot, string][]);
  if (commands.length === 0) return [];
  const language = key ?? "documented";
  return commands.map(([slot, resolved]) => ({
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

export async function determineVerification(deps: DetermineDeps): Promise<PhaseOutcome> {
  const at = deps.now?.() ?? new Date().toISOString();

  /**
   * S-3⁸ (PRDR-121): tooling availability is this phase's question, and symbol
   * intelligence is tooling. Configured and unrunnable is a stop, because the
   * operator asked for it and it is broken — but Detent names the command and
   * does not run it (D-4/F-2).
   */
  const symbols = probeSymbols(deps.symbols);
  if (symbols.kind === "missing") {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_SETUP_CONSENT",
      message: symbolsSetupMessage(deps.symbols as SymbolsConfig, symbols.reason),
      items: ["symbols"],
    };
  }

  /** ---- greenfield: propose from the chosen stack, do not execute (C-4) ---- */
  if (deps.greenfield) {
    const stack = deps.stack ?? null;
    if (stack === null) {
      return {
        kind: "interrupt",
        interrupt: "AWAIT_SETUP_CONSENT",
        message: [
          "In a new project the stack is a decision, and the decision log records none (D-10′),",
          "so there is nothing to bind a gate to.",
          "",
          `Record it under \`## Stack\` in ${DECISION_LOG_PATH}, with the root package's gate commands`,
          "under `## Packages`, and re-run `detent init`.",
        ].join("\n"),
        items: ["stack"],
      };
    }
    const bindings = provisionalBindingsFor(stack, at);
    if (bindings.length === 0) {
      return {
        kind: "interrupt",
        interrupt: "AWAIT_SETUP_CONSENT",
        message: [
          "No conventional verification commands are known for the chosen stack,",
          "so Detent cannot propose even provisional bindings.",
          "",
          `Record the root package's \`test\` command under \`## Packages\` in ${DECISION_LOG_PATH} and re-run \`detent init\`.`,
        ].join("\n"),
        items: ["test"],
      };
    }
    /**
     * PRDR-276: the toolchain behind these commands is NOT checked here.
     * PRDR-273 checked it and PRDR-274 installed it from this phase, but an
     * approved plan's `init` runs no phase (C-8), so neither could reach a
     * project that had already planned. `run` checks before its first session
     * and installs on the operator's answer. A stop here would now strand a
     * fresh project: `init` would wait for a compiler that only `run` installs.
     */
    writeBindings(deps.root, { bindings, skips: [] });
    return {
      kind: "complete",
      outputs: {
        bindings: bindings as unknown as Record<string, unknown>[],
        skips: [],
        /**
         * PRDR-156: greenfield executes nothing (C-4), so there is nothing to
         * call vacuous — but the KEY is present, because a phase whose output
         * shape depends on which branch produced it is the same "foreign shape
         * an older build left behind" hazard PRDR-144 is about.
         */
        gate_notices: [],
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
    /**
     * SEC-4 (PRDR-156): the notices from here are both PRINTED to the operator
     * and written into this phase's `gate_notices` output, and they quote the
     * project's own command output. N-1 keeps `scrub` out of the adapter, so
     * this is where it enters.
     */
    redact: scrub,
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

  /**
   * V-1‴ (PRDR-155): a bound gate that may verify nothing. Said HERE, where the
   * operator is watching bindings being chosen, rather than carried to PRESENT
   * — this is the moment the answer is obvious to them, and the binding it
   * describes is on the screen.
   */
  for (const notice of report.notices) deps.note?.(notice);

  return {
    kind: "complete",
    outputs: {
      bindings: report.bindings as unknown as Record<string, unknown>[],
      skips: skips as unknown as Record<string, unknown>[],
      gate_notices: [...report.notices],
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
