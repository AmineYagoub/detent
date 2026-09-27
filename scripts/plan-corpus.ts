import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../src/fs/layout.js";
import type { SliceSpec } from "../src/schemas/init.js";
import type { DraftedTicket } from "../src/init/plan-write.js";

/**
 * PRDR-202 — reading a planned root off disk, once.
 *
 * The measurement harnesses in this directory needed the same thing: the
 * slice specs SLICE assigned and the tickets PLAN cached, from a root that has
 * already been planned. Both had their own copy of it, and both were outside
 * every gate, so when `revisionOutcome` moved from `plan-slices.ts` to
 * `plan-signal.ts` the import broke and `typecheck` did not see it. One is
 * left, `coverage-report.ts`: PRDR-294 deleted `null-review.ts` with the
 * sampled review it measured.
 *
 * The part that actually drifts is this one. `sliceCacheSchema` defaults its
 * additive fields so a cache written before them still HITS — a ticket's
 * `requirement_ids` and `baseline_ids` (PRDR-201) among them — and a
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

  return { root, specs, tickets, planned, docs };
}

/** The tickets one slice owns, in cache order. */
export function sliceTickets(corpus: PlanCorpus, sliceId: string): readonly CorpusTicket[] {
  return corpus.tickets.filter((t) => t.slice === sliceId);
}

/**
 * Whether a module was RUN or merely imported.
 *
 * A harness runs its CLI at the top level, so a test that imports the file for
 * typechecking must not run it: `null-review.ts`, deleted by PRDR-294, launched
 * live sessions and would have spent money the moment it was imported.
 * Observed, not theorised: an injected import error failed to crash it because
 * the unused symbol was stripped, and it went on to start a real sweep against
 * a live root.
 */
export function runDirectly(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return path.resolve(entry) === path.resolve(new URL(moduleUrl).pathname);
}
