import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { SCHEMA_VERSION, upgradeHint } from "../schemas/common.js";
import { CONFORMANCE_RECORD_PATH } from "../schemas/pack.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_MODEL_ROUTING, type RoleId } from "../schemas/roles.js";
import { acquireRunLock, lockHolder, lockPhaseSuffix, type RunLockInfo } from "./run-lock.js";
import { NON_TICKET_FILES } from "./tickets/readers.js";

/**
 * F-3″ (PRDR-300) — carrying a repository's state to the version this build
 * reads.
 *
 * F-3 promised migrations that are explicit, versioned and tested, and until
 * this module there were none: `SCHEMA_VERSION` had been 1 since the first
 * commit, and the stamp was read only to refuse a newer file. So the first
 * persisted shape the 3.1.1 line changes would have had no event to join, and
 * a bumped constant alone turns every file an older build wrote into a schema
 * error.
 *
 * The state is every JSON file under `.detent/` that carries a stamp, except
 * `worktrees/` (a worktree is a checkout, and its `.detent/` is its branch's),
 * plus the pack's conformance record. A file that is not JSON, or has no
 * stamp, is left for its reader to name. The JSONL logs are history, append
 * only, and none of their readers reads a stamp, so they keep their rows as
 * written.
 */

const CONFIG = ".detent/config.json";

type Json = Record<string, unknown>;

type Transform = (value: Json, deps: MigrateDeps, rel: string) => Json;

export interface MigrateDeps {
  /** S-7: the prompt hashes this build ships, which a carried `role@hash` is re-pinned to. */
  readonly promptHashes: Readonly<Record<string, string>>;
  /** Where a rewritten file goes: a temp file and a rename by default (F-3′). */
  readonly write?: (abs: string, text: string) => void;
  readonly alive?: (pid: number) => boolean;
}

export interface Migration {
  /** It carries a file stamped `from` to `from + 1`, nested stamps included. */
  readonly from: number;
  readonly name: string;
  /** What else it changes, keyed by the file's path from the root, or as `<dir>/*.json` for every JSON file directly in `dir`. */
  readonly transforms: Readonly<Record<string, Transform>>;
}

/** A file's own key wins over its directory's. */
function transformOf(migration: Migration, rel: string): Transform | undefined {
  return migration.transforms[rel] ?? migration.transforms[`${path.posix.dirname(rel)}/*.json`];
}

/**
 * S-7: an assignment names the prompt `run` will launch, which is the one this
 * build ships. A role this build does not ship keeps its reference, for its
 * reader to refuse.
 */
function repin(value: Json, deps: MigrateDeps): Json {
  const assignments = value["assignments"];
  if (typeof assignments !== "object" || assignments === null || Array.isArray(assignments)) return value;
  const out: Record<string, unknown> = {};
  for (const [id, ref] of Object.entries(assignments)) {
    const role = typeof ref === "string" ? /^([a-z_]+)@[0-9a-f]{64}$/u.exec(ref)?.[1] : undefined;
    const hash = role === undefined ? undefined : deps.promptHashes[role];
    out[id] = hash === undefined ? ref : `${role}@${hash}`;
  }
  return { ...value, assignments: out };
}

/** S-1‴: the roles the 3.1.1 line adds, each routed in an existing config as `init` would route it (PRDR-281, PRDR-282, PRDR-284). */
const ROLES_ADDED: readonly RoleId[] = ["audit", "spec_write", "spec_review"];

/**
 * S-1‴, S-5′ (PRDR-281): an existing config gains the routing `init` writes
 * for each role this line adds, model and effort separately, and a role it
 * already routes keeps what it says. A routing table that is not an object is
 * left for the config's reader to refuse.
 */
function routeAdded(value: Json): Json {
  const extend = (key: string, defaults: Readonly<Record<RoleId, string>>): unknown => {
    const table = value[key] ?? {};
    if (typeof table !== "object" || table === null || Array.isArray(table)) return table;
    const out: Record<string, unknown> = { ...table };
    for (const role of ROLES_ADDED) if (!Object.hasOwn(out, role)) out[role] = defaults[role];
    return out;
  };
  return { ...value, model_routing: extend("model_routing", DEFAULT_MODEL_ROUTING), effort_routing: extend("effort_routing", DEFAULT_EFFORT_ROUTING) };
}

/**
 * C-2¹³ (PRDR-283): a record now says whether VALIDATE finished on its pack.
 * An older one was written when a record could only mean that its pack was
 * validated, so it says so; one that already says keeps what it says.
 */
function sayValidated(value: Json): Json {
  return Object.hasOwn(value, "validated") ? value : { ...value, validated: true };
}

const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** C-4⁵ (PRDR-292): a ticket names the pack criteria it carries, and one drafted before the field carried none. */
function withCriteria(ticket: unknown): unknown {
  return isJson(ticket) && !Object.hasOwn(ticket, "criterion_ids") ? { ...ticket, criterion_ids: [] } : ticket;
}

/** A ticket file; the plan, its presentation and its approval are not tickets, and are left as they are. */
const ticketFile: Transform = (value, _deps, rel) => (NON_TICKET_FILES.has(path.posix.basename(rel)) ? value : (withCriteria(value) as Json));

/**
 * C-3⁗, C-4⁵ (PRDR-292): a draft, a slice's cache and a slice the whole-plan
 * review had redrafted each trade `questions` for `spec_defects`, since no
 * planning stage asks, and each of their tickets names its criteria. What was
 * asked is dropped: none of it quoted the pack, so none of it is a defect.
 */
function drafted(value: Json): Json {
  const rest: Json = { ...value };
  delete rest["questions"];
  return {
    ...rest,
    ...(Array.isArray(value["tickets"]) ? { tickets: value["tickets"].map(withCriteria) } : {}),
    ...(Object.hasOwn(value, "spec_defects") ? {} : { spec_defects: [] }),
  };
}

const wholePlan: Transform = (value) =>
  Array.isArray(value["redrafted"]) ? { ...value, redrafted: value["redrafted"].map((r) => (isJson(r) ? drafted(r) : r)) } : value;

/** V-5′ (PRDR-295): an entry bound before packages was the root's. */
const rooted = (entry: unknown): unknown => (isJson(entry) && !Object.hasOwn(entry, "package") ? { ...entry, package: "." } : entry);

/**
 * V-5′ (PRDR-295): a binding and a skip name their package, and the file names
 * every package. A file bound before packages bound the root alone, so each of
 * its entries is the root's, and the root is its one package.
 */
const packaged: Transform = (value) => ({
  ...value,
  ...(Array.isArray(value["bindings"]) ? { bindings: value["bindings"].map(rooted) } : {}),
  ...(Array.isArray(value["skips"]) ? { skips: value["skips"].map(rooted) } : {}),
  ...(Object.hasOwn(value, "packages") ? {} : { packages: ["."] }),
});

/**
 * F-3″: one entry per version, in order. S-1‴ puts the 3.1.1 line's persisted
 * shapes in one event, so each of them adds its step to this entry rather than
 * a new one. The three prompts that named the version stopped naming it here,
 * and their hashes moved, which is the re-pin; `audit`, `spec_write` and
 * `spec_review` joined the roles, which is the routing (PRDR-281, PRDR-282,
 * PRDR-284); the conformance record gained `validated` (PRDR-283). Three
 * shapes need no step. C-2⁶'s rounds key, `spec_validation_rounds`: a
 * config's budgets take the default of every key they omit, and `init` writes
 * one key alone. The record's rounds, whose open findings gained an id and
 * why each is open (PRDR-284): no build wrote a round before them, so only a
 * record written by hand holds the older shape, and its reader refuses it by
 * name (C-2⁹). And D-10′'s phase list, which lost ANALYZE (PRDR-290): its
 * checkpoint is carried like any other file, and `init`, which alone reads
 * checkpoints, reads it as the sign to re-run from DECIDE, and says so. That
 * reading is `init`'s, not this step's, because a state written by a 3.1.1
 * build before PRDR-290 holds the same checkpoint at this version, and no
 * migration runs on it.
 *
 * PLAN's draft and the tickets it writes changed shape too (PRDR-292): a
 * ticket gains `criterion_ids`, and a draft, each slice's cache and the
 * whole-plan review's cache trade `questions` for `spec_defects`. SLICE's
 * artifact lost `questions` as well and needs no step: it is removed before
 * every launch, and read only after one.
 *
 * Gates bind per package (PRDR-295, D-5′): `bindings.json` names every
 * package, and each binding and skip its own, the root's where it names none.
 * Three shapes that carry gates need no step. DETERMINE_VERIFICATION's
 * checkpoint, whose bindings PLAN reads for their slots alone. The accepted
 * drift of a ticket, whose hashes a root gate keys by its slot as before, and
 * a package's as `package:slot`. And the approvals log, which is history: a
 * row without a package is read as the root's.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    name: "the 3.1.1 line",
    transforms: {
      ".detent/agents/assignments.json": repin,
      ".detent/config.json": routeAdded,
      [CONFORMANCE_RECORD_PATH]: sayValidated,
      ".detent/plan/*.json": ticketFile,
      ".detent/state/plan/*.json": drafted,
      ".detent/state/plan-draft.json": drafted,
      ".detent/state/whole-plan.json": wholePlan,
      ".detent/bindings.json": packaged,
    },
  },
];

export type MigrateOutcome =
  | { readonly kind: "current" }
  | {
      readonly kind: "migrated";
      readonly from: number;
      readonly to: number;
      readonly files: readonly string[];
      readonly brokeStale: RunLockInfo | null;
    }
  | { readonly kind: "refused"; readonly message: string };

const CURRENT: MigrateOutcome = { kind: "current" };

function stampOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const stamp = (value as { schema_version?: unknown }).schema_version;
  return typeof stamp === "number" && Number.isInteger(stamp) && stamp > 0 ? stamp : null;
}

function readJson(abs: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return undefined;
  }
}

/** The state's version: `config.json`'s stamp, which the migration writes last. */
function configVersion(root: string): number | null {
  return stampOf(readJson(path.join(stateDir(root), "config.json")));
}

/** Every JSON file the migration owns, by its path from the root. Symbolic links are not followed. */
function stateFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory() && childRel !== ".detent/worktrees") walk(path.join(abs, entry.name), childRel);
      else if (entry.isFile() && entry.name.endsWith(".json")) out.push(childRel);
    }
  };
  walk(stateDir(root), ".detent");
  if (existsSync(path.join(root, ...CONFORMANCE_RECORD_PATH.split("/")))) out.push(CONFORMANCE_RECORD_PATH);
  return out.sort();
}

interface Found {
  readonly rel: string;
  readonly value: Json;
  readonly version: number;
}

function scan(root: string): { readonly older: readonly Found[]; readonly newer: readonly (readonly [string, number])[] } {
  const older: Found[] = [];
  const newer: (readonly [string, number])[] = [];
  for (const rel of stateFiles(root)) {
    const value = readJson(path.join(root, ...rel.split("/")));
    const version = stampOf(value);
    if (version === null || version === SCHEMA_VERSION) continue;
    if (version > SCHEMA_VERSION) newer.push([rel, version]);
    else older.push({ rel, value: value as Json, version });
  }
  return { older, newer };
}

function restamp(value: unknown, from: number, to: number): unknown {
  if (Array.isArray(value)) return value.map((v) => restamp(v, from, to));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, k === "schema_version" && v === from ? to : restamp(v, from, to)]),
  );
}

function carry(found: Found, deps: MigrateDeps): Json {
  let value = found.value;
  for (const migration of MIGRATIONS) {
    if (migration.from < found.version) continue;
    value = restamp(value, migration.from, migration.from + 1) as Json;
    value = transformOf(migration, found.rel)?.(value, deps, found.rel) ?? value;
  }
  return value;
}

/** F-3: a newer file is refused by name, with the upgrade hint, before anything is written. */
function refuseNewer(newer: readonly (readonly [string, number])[]): MigrateOutcome {
  const [rel, found] = newer[0] as readonly [string, number];
  const more = newer.length > 1 ? ` (and ${String(newer.length - 1)} more)` : "";
  return { kind: "refused", message: `${rel}${more}: ${upgradeHint(found, SCHEMA_VERSION)}` };
}

function atomicWrite(abs: string, text: string): void {
  const tmp = `${abs}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, abs);
}

/**
 * F-3″: carry an older state to this build's version, under the run lock
 * (X-1⁷), or refuse and write nothing.
 *
 * A config at this version is the whole check, so a normal command pays one
 * small read, and a file stamped otherwise in a current state is its reader's
 * to refuse. Otherwise the state is scanned twice: once to learn whether there
 * is anything to do, since taking the lock creates `.detent/state/`, and again
 * under the lock, because another process may have written in between.
 * `config.json` is written last, so a migration cut short leaves the state
 * older and the next command resumes it; a file already carried is current,
 * and is skipped.
 */
export function migrateState(root: string, deps: MigrateDeps): MigrateOutcome {
  if (configVersion(root) === SCHEMA_VERSION) return CURRENT;
  const first = scan(root);
  if (first.newer.length > 0) return refuseNewer(first.newer);
  if (first.older.length === 0) return CURRENT;

  const from = Math.min(...first.older.map((f) => f.version));
  /* No `.detent/` means no run can hold the root, and the lock would create one. */
  const lock = existsSync(stateDir(root)) ? acquireRunLock(root, deps.alive === undefined ? {} : { alive: deps.alive }) : null;
  if (lock !== null && !lock.ok) {
    return {
      kind: "refused",
      message:
        `another process holds this root (${lockHolder(lock.heldBy)}), and it may be writing the files a migration ` +
        `from schema_version ${String(from)} to ${String(SCHEMA_VERSION)} rewrites (X-1⁷, F-3″). Wait for it to finish, ` +
        "or remove .detent/state/run.lock if that process is gone.",
    };
  }
  try {
    const { older, newer } = scan(root);
    if (newer.length > 0) return refuseNewer(newer);
    if (older.length === 0) return CURRENT;
    const write = deps.write ?? atomicWrite;
    for (const found of [...older.filter((f) => f.rel !== CONFIG), ...older.filter((f) => f.rel === CONFIG)]) {
      write(path.join(root, ...found.rel.split("/")), `${JSON.stringify(carry(found, deps), null, 2)}\n`);
    }
    return {
      kind: "migrated",
      from: Math.min(...older.map((f) => f.version)),
      to: SCHEMA_VERSION,
      files: older.map((f) => f.rel),
      brokeStale: lock?.ok === true ? lock.brokeStale : null,
    };
  } finally {
    if (lock?.ok === true) lock.release();
  }
}

/** `.detent/plan (6)`: where the rewritten files are, by directory. */
function where(files: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const rel of files) {
    const parts = rel.split("/");
    const key = parts[0] === ".detent" && parts.length > 2 ? `.detent/${parts[1] ?? ""}` : rel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, n]) => (key.endsWith(".json") ? key : `${key} (${String(n)})`))
    .join(", ");
}

/** F-3″: what a migration rewrote, said by the command that ran it; nothing when there was none. */
export function migrationNote(outcome: MigrateOutcome): string | null {
  if (outcome.kind !== "migrated") return null;
  const n = outcome.files.length;
  const lines = [
    `migrated this repository's state from schema_version ${String(outcome.from)} to ${String(outcome.to)} (F-3″): ` +
      `rewrote ${String(n)} file${n === 1 ? "" : "s"}, ${where(outcome.files)}`,
  ];
  if (outcome.brokeStale !== null) {
    lines.push(`broke a stale run lock left by pid ${String(outcome.brokeStale.pid)} on this host${lockPhaseSuffix(outcome.brokeStale)} (X-1⁷)`);
  }
  return lines.join("\n");
}

/**
 * F-3″: what a command that does not migrate says about a state it cannot
 * read. An older state is named with the two commands that carry it, rather
 * than as a list of schema errors; a newer one gets F-3's upgrade hint.
 * Nothing for a current state, or for none.
 */
export function stateVersionRefusal(root: string): string | null {
  const version = configVersion(root);
  if (version === null || version === SCHEMA_VERSION) return null;
  if (version > SCHEMA_VERSION) return `${CONFIG}: ${upgradeHint(version, SCHEMA_VERSION)}`;
  return (
    `this repository's state is at schema_version ${String(version)}, and this build reads ${String(SCHEMA_VERSION)}. ` +
    "`detent init` or `detent run` migrates it (F-3″). This command does not, so it stops here and writes nothing."
  );
}
