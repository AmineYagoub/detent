import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../src/fs/layout.js";
import type { SliceSpec } from "../src/schemas/init.js";
import type { DraftedTicket } from "../src/init/plan-write.js";

/**
 * PRDR-202 — reading a planned root off disk, once.
 *
 * The measurement harnesses in this directory both need the same thing: the
 * slice specs SLICE assigned and the tickets PLAN cached, from a root that has
 * already been planned. Both had their own copy of it, and both were outside
 * every gate, so when `revisionOutcome` moved from `plan-slices.ts` to
 * `plan-signal.ts` the import broke and `typecheck` did not see it.
 *
 * The part that actually drifts is this one. `sliceCacheSchema` defaults its
 * additive fields so a cache written before them still HITS — `churn`
 * (PRDR-200), `requirement_ids` and `baseline_ids` (PRDR-201) — and a
 * hand-rolled reader gets no schema and therefore no defaults. It fills them
 * here, in one place, and a test pins that it does.
 */

/**
 * A ticket as the SCHEMA would hand it back, from a file that may predate a
 * field. `DraftedTicket` already requires `requirement_ids` and `baseline_ids`
 * because `planDraftSchema` defaults them; the reader's whole job is to supply
 * that default for a raw file read, which gets no schema. Re-declaring them
 * here as `readonly` narrowed the type away from what `applyContracts` accepts
 * — caught by this directory's new typecheck coverage on its first run.
 */
export type CorpusTicket = DraftedTicket;

export interface PlanCorpus {
  readonly root: string;
  readonly specs: readonly SliceSpec[];
  /** Every cached ticket, in slice order, with the additive fields defaulted. */
  readonly tickets: readonly CorpusTicket[];
  /** Slice ids that actually have a cache — C-2‴ plans one at a time. */
  readonly planned: readonly string[];
  readonly docs: readonly string[];
  readonly spend: { readonly usd: number; readonly sessions: number };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/** Every cached slice's tickets, oldest slice first, additive fields defaulted. */
export function readPlannedRoot(root: string): PlanCorpus {
  const dir = path.join(stateDir(root), "state", "plan");
  if (!existsSync(dir)) throw new Error(`no slice cache at ${dir} — is this an inited root?`);

  const tickets: CorpusTicket[] = [];
  const planned: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const cached = readJson(path.join(dir, file)) as { tickets?: readonly DraftedTicket[] };
    const own = cached.tickets ?? [];
    if (own.length === 0) continue;
    planned.push(file.replace(/\.json$/, ""));
    for (const t of own) {
      tickets.push({ ...t, requirement_ids: t.requirement_ids ?? [], baseline_ids: t.baseline_ids ?? [] });
    }
  }

  const specsFile = path.join(stateDir(root), "state", "slices.json");
  const specs = existsSync(specsFile)
    ? ((readJson(specsFile) as { slices?: readonly SliceSpec[] }).slices ?? [])
    : [];

  const discoverFile = path.join(stateDir(root), "state", "DISCOVER.json");
  const docs = existsSync(discoverFile)
    ? ((readJson(discoverFile) as { outputs?: { docs?: readonly string[] } }).outputs?.docs ?? [])
    : [];

  return { root, specs, tickets, planned, docs, spend: ledgerSpend(root) };
}

/** What a root has spent, for a harness to report what its own sweep cost. */
export function ledgerSpend(root: string): { readonly usd: number; readonly sessions: number } {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return { usd: 0, sessions: 0 };
  let usd = 0;
  let sessions = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    usd += (JSON.parse(line) as { cost_estimate_usd?: number }).cost_estimate_usd ?? 0;
    sessions += 1;
  }
  return { usd, sessions };
}

/** The tickets one slice owns, in cache order. */
export function sliceTickets(corpus: PlanCorpus, sliceId: string): readonly CorpusTicket[] {
  return corpus.tickets.filter((t) => t.slice === sliceId);
}

/**
 * Whether a module was RUN or merely imported.
 *
 * Both harnesses launch live sessions, so a top-level `main()` would spend
 * money the moment a test imported the file for typechecking. Observed, not
 * theorised: an injected import error failed to crash `null-review.ts` because
 * the unused symbol was stripped, and the harness went on to start a real sweep
 * against a live root.
 */
export function runDirectly(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return path.resolve(entry) === path.resolve(new URL(moduleUrl).pathname);
}
