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
