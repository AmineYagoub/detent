import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PRDR-192 — the gate for `tickets/prd-review/`.
 *
 * Every other artifact this repository ships is gated: `lint`, `typecheck`,
 * `parity:check`, `prompts:check`, `rules:check`. The tickets are the record of
 * WHY the code is the way it is — cited from source comments, quoted in commit
 * messages — and nothing read them, so they drifted five ways at once: 19 files
 * with no frontmatter, 31 of 34 `OPEN` states on work that had landed, two
 * encodings of `acceptance_criteria`, an undocumented id suffix, and one `id`
 * disagreeing with its filename.
 *
 * The rule that earns this file is `state/stale-open`. The others are shape
 * checks any linter could make; that one asks whether the record AGREES WITH
 * THE TREE, which is the property that actually decayed and the only one a
 * reader was relying on.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TICKET_DIR = "tickets/prd-review";

export interface TicketViolation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/** The closed set. A state outside it is a typo nobody would notice otherwise. */
export const TICKET_STATES: readonly string[] = ["OPEN", "READY", "DONE"];

/**
 * Keys every ticket carries. Taken from the 131 files that have frontmatter
 * rather than invented: this gate enforces the convention the repository
 * already chose, and inventing a requirement it never adopted is how a checker
 * starts lying about its own authority (the lesson `check-rules.ts` records).
 */
export const REQUIRED_KEYS: readonly string[] = [
  "id",
  "title",
  "state",
  "severity",
  "category",
  "labels",
  "surface",
  "prd_refs",
  "acceptance_criteria",
  "non_goals",
  "attempts",
  "links",
  "depends_on",
];

/** `PRDR-131a` and `PRDR-145b` are real ids; the suffix splits one ticket in two. */
const FILENAME_ID = /^(PRDR-\d+[a-z]?)-/;

export function ticketFiles(dir: string): string[] {
  try {
    statSync(dir);
  } catch {
    /* A tree without the ticket directory has nothing to check; not a violation. */
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && FILENAME_ID.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function frontmatter(source: string): string | null {
  if (!source.startsWith("---")) return null;
  const end = source.indexOf("\n---", 3);
  return end === -1 ? null : source.slice(3, end);
}

/**
 * Every rule this gate can decide, for one ticket.
 *
 * `landed` is injected rather than read here: whether a ticket's work reached
 * the tree is evidence gathered once for the whole run, and a rule that shelled
 * out per file would be both slow and untestable.
 */
export function violationsIn(rel: string, source: string, landed: boolean): TicketViolation[] {
  const found: TicketViolation[] = [];
  const add = (rule: string, detail: string): void => {
    found.push({ file: rel, rule, detail });
  };
  const base = path.basename(rel);
  const nameId = FILENAME_ID.exec(base)?.[1] ?? "";

  /**
   * Distinguished from a missing header because they are different failures.
   * All 19 offenders in the tree this gate was written against are EMPTY — the
   * filename carries the title and the file carries nothing. Their reasoning
   * was written into the commit that created them instead (`e192c25`,
   * `e02cf44`), so it is recoverable rather than lost, and a checker that said
   * only "no frontmatter" would have hidden that.
   */
  if (source.trim() === "") {
    add("ticket/empty", "the file is empty — the ticket exists as a filename only; its reasoning is in the commit that created it");
    return found;
  }
  const fm = frontmatter(source);
  if (fm === null) {
    add("frontmatter/absent", "a ticket carries YAML frontmatter — id, state, surface and the rest");
    return found;
  }

  for (const key of REQUIRED_KEYS) {
    if (!new RegExp(`^${key}:`, "m").test(fm)) {
      add("frontmatter/missing-key", `\`${key}\` is missing`);
    }
  }

  const declared = /^id:\s*(\S+)/m.exec(fm)?.[1];
  if (declared !== undefined && declared !== nameId) {
    add("id/filename-mismatch", `\`id: ${declared}\` but the filename says \`${nameId}\``);
  }

  const state = /^state:\s*(\S+)/m.exec(fm)?.[1];
  if (state !== undefined && !TICKET_STATES.includes(state)) {
    add("state/unknown", `\`${state}\` is not one of ${TICKET_STATES.join(", ")}`);
  }

  /**
   * The rule this gate exists for. `DONE` is reliable — nobody marks done what
   * is not — and `OPEN` is not, because everybody forgets to close what is. A
   * ticket whose id is cited in shipped code has landed, whatever it says, and
   * a reader who trusts the field is misled in the one direction that matters.
   */
  if (landed && state !== undefined && state !== "DONE") {
    add("state/stale-open", `says \`${state}\`, but the id is cited in shipped code — close it or explain why it is still open`);
  }

  return found;
}

/**
 * Ids cited anywhere the product ships from. Deliberately a filesystem scan and
 * not `git log`: a commit message can name a ticket it merely mentions, whereas
 * a citation in `src/` is the code itself saying which ticket put it there.
 */
export function citedIds(root: string, dirs: readonly string[] = ["src", "tests", "scripts", "prompts"]): Set<string> {
  const seen = new Set<string>();
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      /* A tree missing one of these directories cites nothing from it. */
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else for (const m of readFileSync(full, "utf8").matchAll(/PRDR-\d+[a-z]?/g)) seen.add(m[0]);
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return seen;
}

export function checkTickets(root: string = ROOT): TicketViolation[] {
  const cited = citedIds(root);
  const found: TicketViolation[] = [];
  for (const file of ticketFiles(path.join(root, TICKET_DIR))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const id = FILENAME_ID.exec(path.basename(file))?.[1] ?? "";
    found.push(...violationsIn(rel, readFileSync(file, "utf8"), cited.has(id)));
  }
  return found;
}

/** What a green run of this gate does and does not mean. */
export const UNCHECKED: readonly string[] = [
  "whether a ticket's acceptance criteria are actually met — needs a reader",
  "whether `DONE` is honest; only the reverse, an OPEN the tree contradicts, is decidable",
  "a ticket landed in a surface nothing cites (a PRD amendment, LICENSE) reads as open and is not flagged",
  "whether an empty ticket's recovered body is FAITHFUL to the commit it came from — needs a reader",
];

function main(): number {
  const violations = checkTickets();
  if (violations.length === 0) {
    process.stdout.write(
      `tickets: ${String(UNCHECKED.length)} propert${UNCHECKED.length === 1 ? "y is" : "ies are"} not mechanically checkable and are not claimed here.\n` +
        "tickets:check clean.\n",
    );
    return 0;
  }
  for (const v of violations) process.stderr.write(`${v.file}  [${v.rule}]  ${v.detail}\n`);
  process.stderr.write(`\n${String(violations.length)} ticket violation(s) across ${String(new Set(violations.map((v) => v.file)).size)} file(s).\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
