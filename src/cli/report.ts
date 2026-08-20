import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { baseReflogWrites } from "../kernel/git.js";
import { allTickets } from "../kernel/tickets/readers.js";
import { stateDir } from "../fs/layout.js";
import { transitionLineSchema, ledgerRowSchema, type TransitionLine, type LedgerRow } from "../schemas/records.js";

/**
 * T-053 — `detent report`: all eight §14 metrics, computed from artifacts
 * alone (N-5: transitions + ledger + journals reconstruct any run). The
 * metric key set is pinned against the PRD's own table by test, so a metric
 * added to §14 without a reporter fails CI — the check that would have caught
 * scope-canary going unreported.
 */

export const METRIC_KEYS = [
  "autonomous_completion_rate",
  "median_sessions_per_completed_ticket",
  "scope_canary_block_rate",
  "base_branch_writes",
  "research_cache_hit_rate",
  "prompt_cache_read_rate",
  "crash_resume_correctness",
  "self_build_gate",
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

interface MetricValue {
  readonly value: number | string | null;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly detail: string;
}

export type Report = Record<MetricKey, MetricValue>;

export interface ReportOptions {
  /** §14: the canary corpus is named by the caller (the SEC pack in CI). */
  readonly canaryIds?: readonly string[];
  /** The base branch for the reflog metric; recorded by T-042 per run branch. */
  readonly baseBranch?: string;
}

function readJsonl<T>(file: string, parse: (raw: unknown) => T): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(parse(JSON.parse(line)));
    } catch {
      /* torn line: N-5 reconstruction reports what it can */
    }
  }
  return out;
}

export function buildReport(root: string, opts: ReportOptions = {}): Report {
  const transitions = readJsonl(path.join(stateDir(root), "transitions.jsonl"), (r) => transitionLineSchema.parse(r));
  const ledger = readJsonl(path.join(stateDir(root), "ledger.jsonl"), (r) => ledgerRowSchema.parse(r));
  const tickets = allTickets(root);

  return {
    autonomous_completion_rate: autonomousCompletion(transitions, tickets),
    median_sessions_per_completed_ticket: medianSessions(tickets),
    scope_canary_block_rate: canaryBlocks(tickets, opts.canaryIds ?? []),
    base_branch_writes: baseWrites(root, opts.baseBranch),
    research_cache_hit_rate: researchCacheHits(transitions),
    prompt_cache_read_rate: promptCacheReads(ledger),
    crash_resume_correctness: crashResume(root, tickets),
    self_build_gate: { value: "not-yet-run", detail: "N-7 first green lands at M3; a release gate thereafter" },
  };
}

/** §14: DONE with no NEEDS_HUMAN/BLOCKED in any generation and no B-4 approval. */
function autonomousCompletion(transitions: readonly TransitionLine[], tickets: readonly ReturnType<typeof allTickets>[number][]): MetricValue {
  const done = tickets.filter((t) => t.state === "DONE");
  const intervened = new Set(
    transitions
      .filter((l) => l.to === "NEEDS_HUMAN" || l.to === "BLOCKED" || l.event === "RISK_LABEL_REQUIRED")
      .map((l) => l.ticket),
  );
  const autonomous = done.filter((t) => !intervened.has(t.id));
  return {
    value: done.length === 0 ? null : autonomous.length / done.length,
    numerator: autonomous.length,
    denominator: done.length,
    detail: "tickets reaching DONE with no human intervention in any generation (target ≥70%)",
  };
}

function medianSessions(tickets: readonly ReturnType<typeof allTickets>[number][]): MetricValue {
  const done = tickets.filter((t) => t.state === "DONE");
  const totals = done
    .map((t) => t.generations.reduce((a, g) => a + g.counters.sessions, 0))
    .sort((a, b) => a - b);
  const median =
    totals.length === 0
      ? null
      : totals.length % 2 === 1
        ? (totals[(totals.length - 1) / 2] as number)
        : ((totals[totals.length / 2 - 1] as number) + (totals[totals.length / 2] as number)) / 2;
  return { value: median, denominator: done.length, detail: "median sessions per completed ticket, cumulative across generations (target ≤2.5)" };
}

/** SEC-3: a canary is blocked when it never reaches DONE and its surface stayed honest. */
function canaryBlocks(tickets: readonly ReturnType<typeof allTickets>[number][], canaryIds: readonly string[]): MetricValue {
  if (canaryIds.length === 0) return { value: null, denominator: 0, detail: "no canary corpus supplied for this run" };
  const canaries = tickets.filter((t) => canaryIds.includes(t.id));
  const blocked = canaries.filter((t) => t.state !== "DONE");
  return {
    value: canaries.length === 0 ? null : blocked.length / canaries.length,
    numerator: blocked.length,
    denominator: canaries.length,
    detail: "scope-canary tickets blocked rather than silently widened (target 100%)",
  };
}

function baseWrites(root: string, base: string | undefined): MetricValue {
  if (base === undefined) return { value: null, detail: "no base branch named; pass one to read its reflog (§14)" };
  const writes = baseReflogWrites(root, base);
  return { value: writes, detail: `reflog entries on ${base} beyond creation — includes reverted tampering (target 0)` };
}

function researchCacheHits(transitions: readonly TransitionLine[]): MetricValue {
  const valid = transitions.filter((l) => l.event === "RESEARCH_VALID");
  const hits = valid.filter((l) => l.evidence.includes("cache hit"));
  return {
    value: valid.length === 0 ? null : hits.length / valid.length,
    numerator: hits.length,
    denominator: valid.length,
    detail: "research briefs served from the D-18 cache (reported, not gated)",
  };
}

function promptCacheReads(ledger: readonly LedgerRow[]): MetricValue {
  const input = ledger.reduce((a, r) => a + r.input_tokens + r.cache_read_input_tokens, 0);
  const read = ledger.reduce((a, r) => a + r.cache_read_input_tokens, 0);
  return {
    value: input === 0 ? null : read / input,
    numerator: read,
    denominator: input,
    detail: "cache-read tokens ÷ total input tokens (S-6's effect, reported not gated)",
  };
}

/** §14: injected crashes recovering with no duplicate blind fix. */
function crashResume(root: string, tickets: readonly ReturnType<typeof allTickets>[number][]): MetricValue {
  let crashes = 0;
  let clean = 0;
  for (const ticket of tickets) {
    const journal = path.join(stateDir(root), "runs", ticket.id, "journal.jsonl");
    if (!existsSync(journal)) continue;
    const lines = readFileSync(journal, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { stage?: string; event?: string });
    if (!lines.some((l) => l.event === "skipped_after_crash")) continue;
    crashes += 1;
    const blindStarts = lines.filter((l) => l.stage === "blind_fix" && l.event === "start").length;
    if (blindStarts <= 1) clean += 1;
  }
  return {
    value: crashes === 0 ? null : clean / crashes,
    numerator: clean,
    denominator: crashes,
    detail: "crashed sessions resuming with no duplicate blind fix (target 100%)",
  };
}

export function renderReport(report: Report): string {
  const lines = ["detent report (§14)"];
  for (const key of METRIC_KEYS) {
    const metric = report[key];
    const value =
      metric.value === null
        ? "n/a"
        : typeof metric.value === "number"
          ? Number.isInteger(metric.value)
            ? String(metric.value)
            : `${(metric.value * 100).toFixed(1)}%`
          : metric.value;
    const ratio =
      metric.numerator !== undefined && metric.denominator !== undefined
        ? ` (${metric.numerator}/${metric.denominator})`
        : "";
    lines.push(`  ${key}: ${value}${ratio} — ${metric.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv: readonly string[]): number {
  const root = argv[0] ?? process.cwd();
  process.stdout.write(renderReport(buildReport(root)));
  return 0;
}
