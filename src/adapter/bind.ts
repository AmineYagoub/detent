import { bindingSchema, type Binding } from "../schemas/records.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { plausible, type Candidate, type Discovery, type StackFacts } from "./discover/types.js";
import { normalizeInvocation, type Invocation } from "./normalize.js";
import { GATE_SLOTS, looksLikeWatchMode, runGate, runnable, type GateResult, type GateSlot } from "./run.js";

/**
 * T-026 — binding execution (V-1, V-2).
 *
 * P4: an unexecuted binding is a guess. Every candidate is run once, with a
 * timeout, before it may be approved — including the auto-accepted ones, which
 * C-3b is explicit about. A candidate that has to be killed is watch-mode and
 * is rejected with an explanation rather than bound and discovered later.
 *
 * What this module never does is choose between two equally plausible
 * candidates. That is an interrupt (AWAIT_BINDING_CHOICE), and V-1 calls
 * guessing there a defect.
 */

import { CEILINGS } from "../schemas/budgets.js";

/** X-1's `binding_probe_timeout_ms` default — deliberately shorter than the gate
 *  timeout: a probe asks "does this terminate at all" (PRDR-061). */
export const DEFAULT_PROBE_TIMEOUT_MS: number = CEILINGS.binding_probe_timeout_ms.default;

type RejectReason = "watch-mode" | "unrunnable";

/**
 * V-1 (PRDR-076, found by field test 2): interpreter-wrapped absence.
 * `python -m build` with no `build` package EXECUTES — the interpreter runs,
 * prints the absence, exits 1 — so the oracle's 127-based `runnable` reads a
 * missing tool as a red-but-valid gate. A PROBE that sees the interpreter's
 * own absence message is binding a gate whose tool does not exist; the same
 * text at live gate time stays with the ladder, which can research and say so.
 * The exit guard keeps a green command that merely PRINTS the phrase bindable.
 *
 * Amendment (field test 3): a compiler DIAGNOSTIC is not absence. tsc on an
 * unbuilt monorepo emits `error TS2307: Cannot find module '@scope/pkg'` —
 * the tool ran and truthfully reported a red tree. The node pattern is pinned
 * to the runtime loader's own line shape, and any `error TS####` marker
 * proves a running tool regardless of phrasing.
 */
const ABSENCE_PATTERNS = [/No module named '?([A-Za-z0-9_./@-]+)'?/i, /Cannot find module '([^']+)'/];
const TOOL_RAN_MARKERS = [/error TS\d{4}/];

/**
 * Second amendment (CI, first red on main): absence must NAME THE INVOCATION.
 * A red suite's stack trace can quote "Cannot find module './helpers.js'" —
 * user code failing, a perfectly good red gate — while `python -m build`
 * missing its module quotes the very name the command invokes. Only a match
 * whose captured module appears in the command itself reads as absence;
 * everything else binds red, the pre-refinement behavior.
 */
function toolingAbsent(result: GateResult, command: string): boolean {
  if (result.exitCode === 0) return false;
  if (TOOL_RAN_MARKERS.some((pattern) => pattern.test(result.output))) return false;
  for (const pattern of ABSENCE_PATTERNS) {
    const match = pattern.exec(result.output);
    if (match?.[1] !== undefined && command.includes(match[1])) return true;
  }
  return false;
}

interface BoundOutcome {
  readonly kind: "bound";
  readonly slot: GateSlot;
  readonly binding: Binding;
  /**
   * V-1‴ (PRDR-156): the candidate the binding came from. `Binding` carries
   * `config_hash` but not `config_region`, and the region is the script body
   * or recipe block — the only place the command's actual TEXT survives.
   */
  readonly candidate: Candidate;
  readonly result: GateResult;
}

export interface ChoiceRequiredOutcome {
  readonly kind: "choice-required";
  readonly slot: GateSlot;
  /** Structured, so C-3b's PRESENT summary can render it without re-deriving. */
  readonly candidates: readonly Candidate[];
}

interface RejectedOutcome {
  readonly kind: "rejected";
  readonly slot: GateSlot;
  readonly candidate: Candidate;
  readonly reason: RejectReason;
  readonly explanation: string;
  readonly result: GateResult;
}

interface UnboundOutcome {
  readonly kind: "unbound";
  readonly slot: GateSlot;
}

export type SlotOutcome = BoundOutcome | ChoiceRequiredOutcome | RejectedOutcome | UnboundOutcome;

/** V-1: an unbound slot is a human-acknowledged skip, recorded with who and when. */
export interface Skip {
  readonly slot: GateSlot;
  readonly acknowledged_by: string;
  readonly at: string;
}

export type GateRunner = (spec: {
  readonly command: string;
  readonly cwd: string;
  readonly slot: GateSlot;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}) => Promise<GateResult>;

export interface BindOptions {
  readonly root: string;
  readonly timeoutMs?: number;
  readonly runner?: GateRunner;
  readonly now?: () => string;
  /** C-3b provenance. `auto` when Detent chose; a user id when a human did. */
  readonly approvedBy?: string;
  /** C-4: greenfield bindings are provisional until bootstrap ticket #1 passes. */
  readonly status?: Binding["status"];
  readonly facts?: Pick<StackFacts, "pm">;
  readonly normalize?: (candidate: Candidate, facts?: Pick<StackFacts, "pm">) => Invocation;
  /**
   * SEC-4 (PRDR-156): how command output embedded in a notice is redacted.
   * `src/init/bind.ts` — the only production caller — passes `scrub`. Absent,
   * notices stay in memory and are never written or printed, which is all a
   * direct `bindAll` caller in a test does.
   */
  readonly redact?: Redact;
}

const defaultRunner: GateRunner = (spec) =>
  runGate({ command: spec.command, cwd: spec.cwd, slot: spec.slot, timeoutMs: spec.timeoutMs, env: spec.env });

/**
 * Execute one slot's candidates and decide. Ambiguity is answered before
 * anything is executed: asking the human is cheaper than running two suites,
 * and V-1 requires the interrupt regardless of what they would have returned.
 */
export async function bindSlot(
  slot: GateSlot,
  candidates: readonly Candidate[],
  opts: BindOptions,
): Promise<SlotOutcome> {
  const viable = plausible(candidates, slot);
  if (viable.length === 0) return { kind: "unbound", slot };
  if (viable.length > 1) return { kind: "choice-required", slot, candidates: viable };

  const candidate = viable[0] as Candidate;
  const normalize = opts.normalize ?? normalizeInvocation;
  const invocation = normalize(candidate, opts.facts);
  const runner = opts.runner ?? defaultRunner;

  const result = await runner({
    command: invocation.command,
    cwd: opts.root,
    slot,
    timeoutMs: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    env: invocation.env,
  });

  if (looksLikeWatchMode(result)) {
    return {
      kind: "rejected",
      slot,
      candidate,
      reason: "watch-mode",
      explanation:
        `\`${invocation.command}\` did not exit within ${opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS}ms and had to be killed. ` +
        `A gate must terminate; this looks like watch mode. Bind a run-once form of the command instead (V-1).`,
      result,
    };
  }

  if (!runnable(result)) {
    return {
      kind: "rejected",
      slot,
      candidate,
      reason: "unrunnable",
      explanation:
        `\`${invocation.command}\` could not be executed (exit ${result.normalizedExit}). ` +
        `A binding Detent cannot run is not a gate. Install the tooling or bind a different command (V-1).`,
      result,
    };
  }

  if (toolingAbsent(result, invocation.command)) {
    return {
      kind: "rejected",
      slot,
      candidate,
      reason: "unrunnable",
      explanation:
        `\`${invocation.command}\` executed but reported its tooling absent (exit ${result.normalizedExit}). ` +
        `A binding Detent cannot run is not a gate. Install the tooling or bind a different command (V-1).`,
      result,
    };
  }

  /*
   * A command that runs and fails is a perfectly good binding: red tests are
   * the normal state of a repository mid-work, and V-1 asks only that the
   * command executes.
   */
  return {
    kind: "bound",
    slot,
    candidate,
    binding: bindingSchema.parse({
      schema_version: SCHEMA_VERSION,
      slot,
      adapter: candidate.adapter,
      ref: candidate.ref,
      resolved: invocation.command,
      ...(candidate.pm === null ? {} : { pm: candidate.pm }),
      config_hash: candidate.config_hash,
      executed_at: (opts.now ?? (() => new Date().toISOString()))(),
      approved_by: opts.approvedBy ?? "auto",
      status: opts.status ?? "approved",
    } satisfies Binding),
    result,
  };
}

export interface BindReport {
  readonly outcomes: readonly SlotOutcome[];
  readonly bindings: readonly Binding[];
  /** Outcomes a human must resolve: C-3b's two interrupt conditions. */
  readonly interrupts: readonly (ChoiceRequiredOutcome | RejectedOutcome)[];
  readonly unbound: readonly GateSlot[];
  /** V-1‴ (PRDR-155): bound gates that may verify nothing. Evidence, never a refusal. */
  readonly notices: readonly string[];
}

/**
 * V-1‴ (PRDR-155) — a gate that runs cleanly and verifies nothing.
 *
 * `bindSlot` refuses two things: a command that will not terminate (watch mode)
 * and one that cannot execute. A command that exits 0 having done nothing is
 * neither, so it binds — and `"test": "echo no tests here"` becomes an approved
 * gate that passes for the life of the project. P2 says only exit codes count;
 * a gate that always exits 0 makes P2 vacuous. V-1″ closed the adjacent case of
 * NO bound gate; this is the same hole one step in.
 *
 * Evidence and not a refusal, deliberately. A fast silent zero-exit command is
 * ambiguous — `go build ./...` on a small module is exactly that, and so is a
 * lint gate on a clean tree — so refusing it would make `init` unusable on the
 * projects it should serve. The decisive test is breaking the tree and
 * requiring the gate to go red, which is what V-6 does at REVIEW time, where a
 * diff already exists to revert; there is none at bind time. So this measures,
 * records, and hands it to the human, who settles it in a second.
 */
/**
 * PRDR-156: the signal is the command's TEXT, not how long it took.
 *
 * Duration was tried first and does not discriminate. A vacuous `echo` probes
 * in 96 ms of which ~94 ms is npm's own startup, while a warm no-op `make` is
 * 12 ms and legitimate — the populations overlap, and the 500 ms cut flagged
 * all four gates of an ordinary small project, including the 344 ms script the
 * rule's own evidence called real work. A warning that fires on every slot
 * every time is one nobody reads.
 *
 * `config_region` is "the smallest canonical text that determines `resolved`",
 * so the node engine holds `scripts.test=echo no tests here` and make and just
 * hold the recipe block. That text is decidable where a stopwatch is not.
 *
 * Narrow on purpose. `jest --passWithNoTests`, or a suite with no assertions,
 * is not visible here and is not meant to be — V-6 catches those at review
 * time, where a diff exists to revert. A miss leaves the status quo standing;
 * a false accusation on every gate would be a new harm.
 */

/** The executable half of a `config_region`, with each engine's own shape stripped off. */
function commandBody(region: string): string | null {
  /* `exists:<file>` — go, rust, tsc. The command follows from a real tool, never from a script body. */
  if (region.startsWith("exists:")) return null;
  const script = /^scripts\.[^=]+=([\s\S]*)$/.exec(region);
  if (script !== null) return script[1] ?? "";
  /* A make or just recipe block: the first line is the target header, the rest is the recipe. */
  const lines = region.split("\n");
  if (lines.length > 1) return lines.slice(1).join("\n");
  return region;
}

/** Shell statements that exit 0 having done nothing. */
const NO_OP = /^(?:echo|printf|true|exit\s+0)\b|^:$/;

/**
 * True when EVERY statement in the command is a no-op. Splitting is
 * quote-blind on purpose: over-splitting a real command yields fragments that
 * are not no-ops, so it can only cause a miss, never a false accusation.
 */
export function verifiesNothing(region: string): boolean {
  const body = commandBody(region);
  if (body === null) return false;
  const statements = body
    .split(/&&|\|\||;|\n/)
    .map((part) => part.trim().replace(/^[@-]+/, "").trim())
    .filter((part) => part !== "" && !part.startsWith("#"));
  /* An empty script body is the emptiest gate of all. */
  if (statements.length === 0) return true;
  return statements.every((part) => NO_OP.test(part));
}

/**
 * The redaction the caller supplies. REQUIRED, not defaulted to identity:
 * this notice quotes a project's own command output, and a default that does
 * nothing is a default that leaks. N-1 forbids the adapter importing
 * `kernel/scrub.ts`, so the layer that composes them passes it in — which is
 * the same shape `runner` and `normalize` already take here.
 */
export type Redact = (text: string) => string;

export function vacuousGateNotices(outcomes: readonly SlotOutcome[], redact: Redact): string[] {
  const notices: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind !== "bound" || !verifiesNothing(outcome.candidate.config_region)) continue;
    /**
     * SEC-4: scrubbed BEFORE it can reach a file, a stream or a prompt — the
     * same rule `referee-gate.ts` applies to gate output it writes. A project
     * whose test script echoes a token would otherwise put that token into a
     * phase output verbatim.
     */
    const tail = redact(outcome.result.output.trim()).split("\n").slice(-2).join(" / ").slice(0, 120);
    /**
     * The COMMAND too, not just its output. Caught by the pipeline-layer test:
     * a script body is project configuration and can carry a credential —
     * `curl -H "Authorization: Bearer …"` is an ordinary thing to find in one
     * — and this notice quotes it back verbatim.
     */
    const body = redact(commandBody(outcome.candidate.config_region)?.trim() ?? "");
    notices.push(
      `${outcome.slot}: \`${outcome.binding.resolved}\` runs \`${body}\` — every statement in it exits 0 having ` +
        `done nothing. It printed: ${tail === "" ? "(nothing)" : tail} (${outcome.result.durationMs}ms). ` +
        "A gate that always passes verifies nothing, and every ticket goes green against it (V-1‴). " +
        "Evidence, not a refusal — bind a command that can fail, or confirm this is what you meant.",
    )
  }
  return notices;
}

export async function bindAll(discovery: Discovery, opts: BindOptions): Promise<BindReport> {
  const outcomes: SlotOutcome[] = [];
  for (const slot of GATE_SLOTS) {
    outcomes.push(await bindSlot(slot, discovery.candidates, { ...opts, facts: opts.facts ?? { pm: discovery.stack.pm } }));
  }
  return {
    outcomes,
    bindings: outcomes.filter((o): o is BoundOutcome => o.kind === "bound").map((o) => o.binding),
    interrupts: outcomes.filter(
      (o): o is ChoiceRequiredOutcome | RejectedOutcome => o.kind === "choice-required" || o.kind === "rejected",
    ),
    unbound: outcomes.filter((o): o is UnboundOutcome => o.kind === "unbound").map((o) => o.slot),
    notices: vacuousGateNotices(outcomes, opts.redact ?? ((t) => t)),
  };
}

/** V-1: record who acknowledged the skip and when. Never inferred. */
export function acknowledgeSkip(slot: GateSlot, acknowledgedBy: string, at = new Date().toISOString()): Skip {
  if (acknowledgedBy.trim() === "") throw new Error("a skip must name who acknowledged it (V-1)");
  return { slot, acknowledged_by: acknowledgedBy, at };
}

/** Identity of a candidate, stable across a JSON round trip. */
function identity(c: Candidate): string {
  return [c.slot, c.adapter, c.ref, c.resolved, c.config_hash].join("\0");
}

/**
 * The human's answer to AWAIT_BINDING_CHOICE. The chosen candidate is still
 * executed — V-1's order is discovery → execution → approval, and a human
 * choosing does not skip the execution step.
 *
 * Membership is by value, not by reference: C-5 interrupts batch at phase
 * boundaries and resume from a checkpoint (F-4), so the answer arrives in a
 * later process and the object identity of the offer is long gone.
 */
export async function resolveChoice(
  outcome: ChoiceRequiredOutcome,
  chosen: Candidate,
  user: string,
  opts: BindOptions,
): Promise<SlotOutcome> {
  const offered = outcome.candidates.find((c) => identity(c) === identity(chosen));
  if (offered === undefined) {
    throw new Error(`candidate ${chosen.resolved} was not among the choices offered for ${outcome.slot}`);
  }
  return await bindSlot(outcome.slot, [offered], { ...opts, approvedBy: user });
}
