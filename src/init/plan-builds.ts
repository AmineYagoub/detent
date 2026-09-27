import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkpointPath } from "../fs/checkpoints.js";
import { UNRECORDED_BUILD, isMixed } from "../kernel/build.js";
import { INIT_PHASES } from "../schemas/init.js";
import { REPLAN_FROM, redraftRecordPath, sliceCacheDir, slicingRecordPath } from "./machine.js";

/**
 * N-5″ (PRDR-297) — the Detent builds that made the plan, and what each made.
 *
 * What makes the plan is what `detent init --replan` makes again: the phases
 * from DETERMINE_VERIFICATION to PREPARE_AGENTS, the cut SLICE keeps, each
 * slice's cache and each redraft the checks across the plan used (C-8′). So
 * the remedy for a plan several builds made is that flag, and it is whole.
 *
 * The pack the plan was planned from is named by its hash, not by its builds.
 * It is the founder's document set, which they read, and the hash names it
 * whoever wrote it; its phases' checkpoints record their builds all the same.
 * INIT_FS and DISCOVER write nothing the plan holds. Counting any of these
 * would name every plan made after an upgrade as mixed, and a question asked
 * of every plan is answered without being read.
 */

export interface BuildShare {
  readonly build: string;
  /** What it made: a phase by name, `the cut`, a slice's id, or a slice's redraft. */
  readonly made: readonly string[];
}

const PLANNING = INIT_PHASES.slice(INIT_PHASES.indexOf(REPLAN_FROM), INIT_PHASES.indexOf("PRESENT"));

/** The file's JSON, or null where it is absent. A file that will not parse vouches for no build. */
function read(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const named = (value: unknown): string => (typeof value === "string" && value !== "" ? value : UNRECORDED_BUILD);

export function planBuilds(root: string, slices: readonly { readonly id: string }[]): BuildShare[] {
  const made = new Map<string, string[]>();
  const add = (build: string, what: string): void => {
    made.set(build, [...(made.get(build) ?? []), what]);
  };
  for (const phase of PLANNING) {
    const checkpoint = read(checkpointPath(root, phase));
    if (checkpoint !== null) add(named(checkpoint["build"]), phase);
  }
  const cut = read(slicingRecordPath(root));
  if (cut !== null) {
    const recorded: unknown = cut["builds"];
    for (const build of Array.isArray(recorded) && recorded.length > 0 ? (recorded as unknown[]) : [undefined]) add(named(build), "the cut");
  }
  for (const slice of slices) {
    const cache = read(path.join(sliceCacheDir(root), `${slice.id}.json`));
    if (cache !== null) add(named(cache["build"]), slice.id);
  }
  const redrafts = read(redraftRecordPath(root))?.["redrafts"];
  for (const redraft of Array.isArray(redrafts) ? (redrafts as Record<string, unknown>[]) : []) {
    add(named(redraft["build"]), `${String(redraft["slice"])}'s redraft`);
  }
  return [...made].map(([build, what]) => ({ build, made: what }));
}

/** PRESENT's lines for them, or none where nothing is named. */
export function buildLines(shares: readonly BuildShare[], packHash: string | null): string[] {
  if (shares.length === 0) return [];
  const pack = packHash === null ? "without a pack" : `from pack ${packHash.slice(0, 12)}`;
  const builds = shares.map((s) => s.build);
  if (!isMixed(builds)) return ["", `Made by one Detent build, ${builds[0] ?? ""}, ${pack} (N-5″).`];
  const width = Math.max(...builds.map((b) => b.length));
  return [
    "",
    `Made ${pack} by these Detent builds — a plan more than one build made, or with a part that names no build, is approved only once you accept that (N-5″):`,
    ...shares.map(
      (s) => `  ${s.build.padEnd(width)}  ${s.made.join(", ")}${s.build === UNRECORDED_BUILD ? " — written before a checkpoint recorded its build" : ""}`,
    ),
  ];
}
