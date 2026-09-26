import { existsSync } from "node:fs";
import path from "node:path";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { PACK_PATHS, isModulePrd, type ConformanceRecord, type PackFinding } from "../schemas/pack.js";
import type { ReviewFinding } from "../schemas/validate.js";
import { isGreenfield } from "./analyze.js";
import { docPatternsFor } from "./discover-docs.js";
import type { PhaseHandler, PhaseOutcome } from "./machine.js";
import { at } from "./pack-check-rules.js";
import { checkPack } from "./pack-check.js";
import { parsePack } from "./pack-parse.js";
import { classifyPack, conformanceRecord, movedSince, packDocuments, readConformanceRecord, writeConformanceRecord } from "./pack.js";
import type { PipelineDeps } from "./pipeline.js";
import { sessionDeps } from "./session-deps.js";
import { launchInitSession, withInitJournal } from "./session.js";
import { countsOf, mergeFindings, type Finding, type Outcome } from "./validate-checks.js";
import { diffPath, fixFindings, reviewArea, type Fixed, type ReviewTask, type RoundDeps, type Shown } from "./validate-round.js";
import { areaOf, areasOf, reviewable, scopeOf, type Area } from "./validate-scope.js";
import { handoff, packDigest } from "./write.js";

/**
 * C-2⁶, C-2¹⁴ (PRDR-284) — VALIDATE: the pack is checked, then reviewed in
 * rounds, before anything plans from it.
 *
 * A written pack still carries what reading misses, and fixing it introduces
 * new defects: ksarjs needed seven rounds. So the checker runs first, and a
 * red checker is fixed before any round. Each round then runs one reviewer per
 * area of the pack, and one writer applies what they found; the next round
 * verifies those fixes and hunts what they introduced. A round with no blocker
 * and no major ends the loop, its minor findings fixed without another round
 * (specification decision 3). `spec_validation_rounds` is the ceiling: there,
 * the last round's majors go to PRESENT as risks and planning goes on, and a
 * blocker stops `init` here with AWAIT_INFO.
 *
 * The record is written after every round, not validated, so a stopped or
 * killed validation carries on from its last round on the next `init`, and
 * validated when the loop ends. A changed pack is re-validated for its change:
 * its rounds are new, and review what moved, what the last validation left
 * open, and whatever cites either (C-2⁷). A conforming pack runs the checker
 * alone, which DISCOVER's classification already ran, and no session
 * (specification decision 6).
 */

type Round = ConformanceRecord["rounds"][number];
type Open = Round["open"][number];

export interface ValidateStageDeps extends RoundDeps {
  readonly patterns: readonly string[];
  /**
   * `spec_validation_rounds` (X-1): the round a validation stops at. One that
   * stopped there carries on for a round past it when anything in the pack
   * moved since, which is how the operator settles a blocker.
   */
  readonly ceiling: number;
  /** `YYYY-MM-DD`, for the record. */
  readonly today: string;
}

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** What one validation reviews first, and what it carries on from. */
interface Start {
  readonly rounds: readonly Round[];
  /** The documents the first round reviews and whatever cites them; null for the whole pack. */
  readonly seeds: readonly string[] | null;
  /** The findings the first round verifies; null when it reviews. */
  readonly previous: readonly Shown[] | null;
  /** The diff of the fixes the first round verifies, where the round before kept one. */
  readonly diff: string | null;
}

const fileOf = (o: { readonly file: string }): string => o.file;

const shownOf = (o: Open): Shown => ({ id: o.id, severity: o.severity, places: [{ file: o.file, line: Math.max(1, o.line), quote: o.quote }], why: "", fix: o.fix, left: o.left, reason: o.reason });

/**
 * A written pack with no rounds is validated whole. One whose validation
 * stopped carries on from its last round, up to the ceiling, and runs none
 * when nothing moved since and the rounds already say how it ends. A loop
 * always runs the round it starts with, so anything that moved, a removal
 * included, earns one round past the ceiling to verify it. A changed pack's
 * validation is a new one.
 */
function startOf(deps: ValidateStageDeps, record: ConformanceRecord): Start | "concluded" {
  const moved = movedSince(deps.root, record);
  const edited = [...moved.added, ...moved.modified];
  const last = record.rounds.at(-1);
  if (record.validated || last === undefined) {
    const seeds = record.validated ? [...edited, ...(last?.open ?? []).map(fileOf)] : null;
    return { rounds: [], seeds, previous: null, diff: null };
  }
  const anything = edited.length + moved.removed.length > 0;
  const met = last.counts.blocker + last.counts.major === 0;
  if (!anything && (met || record.rounds.length >= deps.ceiling)) return "concluded";
  const kept = diffPath(`round ${String(last.round)}`);
  return {
    rounds: record.rounds,
    seeds: [...edited, ...last.changed, ...last.open.map(fileOf)],
    previous: last.open.map(shownOf),
    diff: existsSync(path.join(deps.root, ...kept.split("/"))) ? kept : null,
  };
}

/** The majors a finished validation's last round left open, as PRESENT lists them beside the defaults (C-2¹⁴). */
export function risksOf(rounds: readonly Round[]): { id: string; where: string; fix: string; left: string; reason: string }[] {
  const last = rounds.at(-1)?.open ?? [];
  return last.filter((o) => o.severity === "major").map((o) => ({ id: o.id, where: `${o.file}:${String(o.line)}`, fix: o.fix, left: o.left, reason: o.reason }));
}

/**
 * What a round leaves open: what was declined or undone, and at the ceiling
 * the fixes to a blocker or a major no round will verify. A ceiling round that
 * meets the stop rule has neither, and its minors are fixed unverified, as
 * every stopping round's are (specification decision 3).
 */
function openOf(findings: readonly Finding[], outcome: ReadonlyMap<string, Outcome>, unverified: boolean): Open[] {
  const open: Open[] = [];
  for (const f of findings) {
    const o = outcome.get(f.id) ?? { left: "declined", reason: "its writer did not run" };
    const place = f.places[0] ?? { file: "", line: 0, quote: "" };
    const row = { id: f.id, severity: f.severity, file: place.file, line: place.line, quote: place.quote, fix: f.fix };
    if (o.left !== "applied") open.push({ ...row, left: o.left, reason: o.reason });
    else if (unverified && f.severity !== "minor") open.push({ ...row, left: "unverified", reason: "fixed in the round the loop stopped at, which no round verified" });
  }
  return open;
}

/** One reviewer per area with a document in scope or a finding of the round before to verify, the foundations first. */
function tasksFor(areas: readonly Area[], scope: readonly string[], previous: readonly Shown[] | null, diff: string | null, heuristic: readonly PackFinding[]): ReviewTask[] {
  const foundations = areas.flatMap((a) => a.documents).filter((rel) => !isModulePrd(rel));
  const owner = (p: Shown): number => Math.max(0, areaOf(areas, p.places[0]?.file ?? ""));
  return areas.flatMap((area, i) => {
    const documents = area.documents.filter((rel) => scope.includes(rel));
    const mine = (previous ?? []).filter((p) => owner(p) === i);
    if (documents.length === 0 && mine.length === 0) return [];
    return [{ area, foundations, documents, previous: previous === null ? null : mine, diff, heuristic: heuristic.filter((f) => documents.includes(f.file)) }];
  });
}

export async function validateStage(deps: ValidateStageDeps): Promise<PhaseOutcome> {
  const { root, greenfield } = deps;
  const status = classifyPack(root, { greenfield });
  const record = readConformanceRecord(root);
  if (record === null || status.kind === "conforming") {
    deps.note?.(
      record === null
        ? "VALIDATE: the documents are no pack, since WRITE wrote none, so nothing is validated, and planning reads them as they are (C-2¹⁴)"
        : "VALIDATE: the pack conforms and its checker is green, so it runs no session, and planning reads it (C-2⁶, specification decision 6)",
    );
    noteUnitComplete(root);
    return finished(deps, record?.rounds ?? [], { ran: false, reason: status.kind });
  }
  const red = await checkerFirst(deps);
  if (red !== null) return red;
  const start = startOf(deps, record);
  if (start === "concluded") {
    deps.note?.(`VALIDATE: nothing in the pack moved since round ${String(record.rounds.length)}, the last its record holds, so no round runs, and its rounds say how the validation ends (C-2¹⁴)`);
    return conclude(deps, record.rounds);
  }
  deps.note?.("VALIDATE: no reviewer runs a simulation, since the scratch directory one needs is not built, so the invariants the pack states are read and never run (C-2¹⁴)");
  return await loop(deps, start);
}

/** C-2⁶: a red checker is fixed before any round, or `init` stops here, since nothing plans from a red pack (C-2⁷). */
async function checkerFirst(deps: ValidateStageDeps): Promise<PhaseOutcome | null> {
  const blocking = (): PackFinding[] => checkPack(deps.root, packDocuments(deps.root), { greenfield: deps.greenfield }).findings.filter((f) => f.blocks);
  const found = blocking();
  if (found.length === 0) return null;
  const findings = found.map((f, n) => ({ id: `CHECK-${String(n + 1)}`, rule: f.rule, at: at(f), text: f.text, message: f.message }));
  deps.note?.(`VALIDATE: the pack checker is red, with ${plural(found.length, "blocking finding")}; its writer fixes them before any round (C-2⁶)`);
  const fixed = await fixFindings(deps, "the checker", findings, "checker");
  if (fixed.stood) return null;
  const left = blocking().map((f) => `${at(f)} [${f.rule}] ${f.message}`);
  return {
    kind: "interrupt",
    interrupt: "AWAIT_INFO",
    message:
      `VALIDATE: the pack checker is red, and its writer could not make it green in two attempts, so nothing plans from the pack (C-2⁷). ` +
      `Fix what it finds, below, and re-run \`detent init\`, which runs VALIDATE again (C-2¹⁴).`,
    items: left,
  };
}

async function loop(deps: ValidateStageDeps, start: Start): Promise<PhaseOutcome> {
  const rounds = [...start.rounds];
  let seeds = start.seeds;
  let previous = start.previous;
  let diff = start.diff;
  for (let r = rounds.length + 1; ; r += 1) {
    const docs = packDocuments(deps.root);
    const { pack } = parsePack(deps.root, docs, { greenfield: deps.greenfield });
    const areas = areasOf(pack, docs);
    const scope = seeds === null ? docs.filter(reviewable) : scopeOf(deps.root, pack, docs, seeds);
    const heuristic = checkPack(deps.root, docs, { greenfield: deps.greenfield }).findings.filter((f) => !f.blocks);
    const tasks = tasksFor(areas, scope, previous, diff, heuristic);
    if (tasks.length === 0) {
      deps.note?.("VALIDATE: nothing that moved is a document a round reviews, so no round runs (C-2¹⁴)");
      return finished(deps, rounds, { ran: true });
    }
    const reported: { area: number; findings: ReviewFinding[] }[] = [];
    for (const task of tasks) reported.push({ area: areas.indexOf(task.area), findings: await reviewArea(deps, r, task, docs.filter(reviewable)) });
    const findings = mergeFindings(r, reported);
    const counts = countsOf(findings);
    const fixed: Fixed =
      findings.length === 0
        ? { outcome: new Map(), changed: [], diff: null, stood: true }
        : await fixFindings(deps, `round ${String(r)}`, findings.map(({ id, severity, category, places, why, fix }) => ({ id, severity, category, places, why, fix })), "review");
    const ends = counts.blocker + counts.major === 0;
    const open = openOf(findings, fixed.outcome, r >= deps.ceiling);
    rounds.push({ round: r, counts, open, changed: [...fixed.changed] });
    save(deps, rounds, false);
    noteUnitComplete(deps.root);
    const left = (kind: Outcome["left"]) => [...fixed.outcome.values()].filter((o) => o.left === kind).length;
    deps.note?.(
      `VALIDATE round ${String(r)}: ${plural(findings.length, "finding")} (${String(counts.blocker)} blocker, ${String(counts.major)} major, ` +
        `${String(counts.minor)} minor); ${String(left("applied"))} fixed, ${String(left("declined"))} declined, ${String(left("undone"))} undone (C-2¹⁴)`,
    );
    if (ends) return finished(deps, rounds, { ran: true });
    if (r >= deps.ceiling) return conclude(deps, rounds);
    seeds = [...fixed.changed, ...findings.flatMap((f) => f.places.map(fileOf))];
    previous = findings.map((f) => ({ id: f.id, severity: f.severity, places: f.places, why: f.why, fix: f.fix, ...(fixed.outcome.get(f.id) ?? { left: "declined", reason: "" }) }));
    diff = fixed.diff;
  }
}

const save = (deps: ValidateStageDeps, rounds: readonly Round[], validated: boolean): void => {
  const checker = checkPack(deps.root, packDocuments(deps.root), { greenfield: deps.greenfield });
  writeConformanceRecord(deps.root, conformanceRecord(deps.root, { checker, rounds: [...rounds], date: deps.today, validated }));
};

/** At the ceiling: a blocker stops `init` here; majors go on to PRESENT as risks (specification decision 13). */
function conclude(deps: ValidateStageDeps, rounds: readonly Round[]): PhaseOutcome {
  const last = rounds.at(-1);
  const blockers = (last?.open ?? []).filter((o) => o.severity === "blocker");
  if (blockers.length === 0) return finished(deps, rounds, { ran: true });
  const stopped = last?.round ?? 0;
  return {
    kind: "interrupt",
    interrupt: "AWAIT_INFO",
    message:
      `VALIDATE stopped at round ${String(stopped)}, its ceiling (spec_validation_rounds is ${String(deps.ceiling)}), with ${plural(blockers.length, "blocker")} ` +
      `left open, and a plan built on an unverified fix to a blocker can be wrong everywhere (C-2⁶). Settle each in the pack, or raise ` +
      `budgets.spec_validation_rounds in .detent/config.json, and re-run \`detent init\`: VALIDATE carries on from round ${String(stopped + 1)} (C-2¹⁴).`,
    items: blockers.map((o) => `${o.id} ${o.file}:${String(o.line)} (${o.left}): ${o.fix}${o.reason === "" ? "" : ` [${o.reason}]`}`),
  };
}

/**
 * The loop is over: the record says so, and the pack and its risks go to
 * planning. The checker's parse of the pack is handed on beside them, as C-2⁶
 * says, and no planning phase reads it yet: D-10′ gives it its reader.
 */
function finished(deps: ValidateStageDeps, rounds: readonly Round[], run: { readonly ran: boolean; readonly reason?: string }): PhaseOutcome {
  const docs = packDocuments(deps.root);
  if (run.ran) {
    save(deps, rounds, true);
    noteUnitComplete(deps.root);
    const risks = risksOf(rounds);
    deps.note?.(`VALIDATE validated the pack in ${plural(rounds.length, "round")}${risks.length === 0 ? "" : `; the majors it left open go to PRESENT as ${plural(risks.length, "risk")}`} (C-2¹⁴)`);
  }
  const record = readConformanceRecord(deps.root);
  return handoff(deps.root, deps.patterns, {
    ...run,
    validated: record?.validated ?? false,
    rounds: rounds.length,
    risks: record?.validated === true ? risksOf(record.rounds) : [],
    pack: record === null ? null : parsePack(deps.root, docs, { greenfield: deps.greenfield }).pack,
  });
}

export function validatePhase(deps: PipelineDeps): PhaseHandler {
  const patterns = docPatternsFor(deps.planDocs);
  return {
    phase: "VALIDATE",
    /* C-2¹⁴: VALIDATE's fixes and record re-run DISCOVER and WRITE on the next init, and must not re-plan; it writes what its digest reads. */
    restartsChain: true,
    keyedAfterRun: true,
    digest: () => packDigest(deps.root, patterns, deps.planDocs),
    run: async () =>
      await withInitJournal(deps.root, async (journal) => {
        const launch = sessionDeps(deps, journal);
        return await validateStage({
          root: deps.root,
          greenfield: isGreenfield(discoverStack(deps.root).stack.markers),
          patterns,
          ceiling: deps.budgets.spec_validation_rounds,
          today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
          note: deps.note,
          review: async (inputs, artifactOut) => {
            await launchInitSession(launch, { role: "spec_review", inputs, artifactOut });
          },
          fix: async (inputs, artifactOut) => {
            await launchInitSession(launch, { role: "spec_write", inputs, artifactOut, surface: PACK_PATHS });
          },
        });
      }),
  };
}
