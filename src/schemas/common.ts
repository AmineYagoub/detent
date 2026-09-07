import { z } from "zod";

/**
 * F-3: every committed file carries `schema_version`; Detent refuses
 * newer-schema files with an upgrade hint rather than guessing.
 */
export const SCHEMA_VERSION = 1;

const schemaVersioned = z.object({
  schema_version: z.number().int().positive(),
});

export const nonEmptyString = z.string().min(1);
export const isoTimestamp = z.iso.datetime({ offset: true });
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");

/**
 * A ticket id becomes a FILE NAME under `.detent/plan/` (F-1), and the plan
 * that produces it is written by a model. Until this existed, `nonEmptyString`
 * accepted `../../package`, which `writeTicket` then joined onto the plan
 * directory and wrote through — outside the repository, over any file the
 * process could reach. It also accepted two ids differing only in case, which
 * are one file on macOS: the plan claimed three tickets, the disk held two,
 * and the pool deadlocked on a ticket the plan said existed.
 *
 * So the id is constrained to what is unambiguous as a filename on every
 * platform: lowercase (case cannot be the only difference), no separators, no
 * dots (no traversal, no extension games), bounded length, and never one of
 * the two reserved artifact names that share the directory.
 */
export const RESERVED_TICKET_IDS: ReadonlySet<string> = new Set(["plan", "approval"]);

export const ticketId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "a ticket id is lowercase a-z, 0-9, `-` and `_`, 1-64 characters, starting alphanumeric")
  .refine((id: string) => !RESERVED_TICKET_IDS.has(id), {
    message: "`plan` and `approval` are reserved: they are artifact names in the same directory",
  });

/** Whether a string is safe to use as a ticket's file name. The floor every writer checks. */
export function isSafeTicketId(id: string): boolean {
  return ticketId.safeParse(id).success;
}

/** A glob pattern; matching semantics are picomatch's throughout (R-6). */
export const glob = nonEmptyString;

export type SchemaCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "invalid"; readonly issues: readonly string[] }
  | { readonly ok: false; readonly reason: "newer-schema"; readonly found: number; readonly supported: number };

/**
 * Parse a committed artifact. A file stamped with a newer schema version is a
 * distinct outcome from an invalid one: F-3 requires refusing it with an
 * upgrade hint (exit 2), never a best-effort read.
 */
export function parseArtifact<T>(schema: z.ZodType<T>, input: unknown): SchemaCheck<T> {
  const stamp = schemaVersioned.safeParse(input);
  if (stamp.success && stamp.data.schema_version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "newer-schema",
      found: stamp.data.schema_version,
      supported: SCHEMA_VERSION,
    };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map(
        (i) => `${i.path.length > 0 ? i.path.join(".") : "<root>"}: ${i.message}`,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

export function upgradeHint(found: number, supported: number): string {
  return `artifact declares schema_version ${found}; this build supports ${supported}. Upgrade Detent to read it — Detent will not guess at a newer schema.`;
}

/**
 * SEC-3′ (PRDR-132) — the immutability floor that stands even when a config
 * under-declares, shared by the policy that ENFORCES it and the lever that
 * grants surface. Those two used to consult different lists: a request for
 * `.detent/config.json` matched no default protected glob, so it was GRANTED
 * and recorded as granted while the write was separately denied — an audit
 * trail stating the opposite of what happened.
 *
 * `.git` is here not because it is sensitive but because writing into it is
 * EXECUTING. `.gitattributes` plus a `filter.<name>.clean` entry in
 * `.git/config` runs a shell command on `git add` — which the implement role
 * holds, and which `finalizeDone` performs itself — so two ordinary file
 * writes yield arbitrary execution without needing an executable bit the
 * `Write` tool cannot set. It is never a legitimate session write target.
 * Both forms are listed: a directory in a normal checkout, a FILE in a
 * worktree.
 */
export const STRUCTURAL_PROTECTED: readonly string[] = [
  ".detent/tickets/**",
  ".detent/config.json",
  ".detent/bindings.json",
  ".detent/plan/**",
  ".git/**",
  ".git",
  /**
   * PRDR-149: the run's own audit trail and the hook's containment files. A
   * granted `.detent` surface reached `ledger.jsonl` — the spend record the
   * D-25 launch gate reads back — and `active_surface.json`, the policy the
   * ambient hook enforces. `.detent/runs/**` stays writable: it is where a
   * session's artifacts legitimately land, and the surface adds it explicitly.
   */
  ".detent/ledger.jsonl",
  ".detent/transitions.jsonl",
  ".detent/state/**",
  ".detent/claims/**",
  ".detent/active_surface.json",
  ".detent/stage.json",
  /** Writing a dependency is writing an executable the gate will run. */
  "node_modules/**",
];

/**
 * SEC-3′: a surface REQUEST names a concrete repo-relative path, or it is not
 * a request. A session that hit one deny could write `{"path":"**"}` and have
 * its own surface widened to the whole worktree — persisted onto the ticket,
 * surviving every later generation. A planner may still declare a broad
 * surface at plan time: that is visible, reviewed and approved by a human. A
 * session granting itself one at run time is none of those things.
 *
 * PRDR-149: this was a BLACKLIST of `* ? [ ]`, and a blacklist of a glob
 * grammar is a losing game. `"."` sailed through and permits everything, which
 * is the exact bypass `**` was blocked for; so did picomatch's extglob
 * (`!(zzz)`) and brace (`{src,.detent}`) forms, which are on by default. It is
 * a whitelist now: ordinary path segments, nothing else. Anything a glob can
 * express is refused by construction rather than by enumeration.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function isConcreteRepoPath(target: string): boolean {
  if (target === "" || target.startsWith("/") || target.startsWith("\\")) return false;
  const segments = target.split(/[\\/]/);
  return segments.every((seg) => seg !== "." && seg !== ".." && SAFE_SEGMENT.test(seg));
}

/**
 * PRDR-149: one spelling for the protected comparison. `.git\config` split
 * into safe segments and then matched nothing, because picomatch treats a
 * backslash as a literal on POSIX — so the request was granted while the
 * enforcement layer would deny it on Windows and not on macOS. Normalising
 * once removes the disagreement rather than teaching two matchers about it.
 */
export function repoPathKey(target: string): string {
  return target.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * PRDR-149: would this requested surface reach anything the floor protects?
 *
 * PRDR-132 unified the LIST and left the MATCHERS apart: the grant used bare
 * `picomatch.isMatch`, enforcement uses `matchAny`, which additionally tries
 * `<bare>/**`. So `.detent` matched no protected glob at grant time — it is
 * their PARENT, not one of them — and then permitted `.detent/ledger.jsonl` at
 * write time. The N-5 audit ledger and the hook's own policy file became
 * session-writable through a request that read as innocuous.
 *
 * Asking the question the other way round settles it: a grant is refused when
 * the surface it would create covers a protected location.
 */
export function coversProtected(target: string, protectedGlobs: readonly string[]): boolean {
  return protectedGlobs.some((glob) => {
    const bare = glob.replace(/\/\*\*$/, "").replace(/\/$/, "");
    return bare === target || bare.startsWith(`${target}/`);
  });
}


