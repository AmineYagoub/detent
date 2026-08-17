import { z } from "zod";

/**
 * F-3: every committed file carries `schema_version`; Detent refuses
 * newer-schema files with an upgrade hint rather than guessing.
 */
export const SCHEMA_VERSION = 1;

export const schemaVersioned = z.object({
  schema_version: z.number().int().positive(),
});

export const nonEmptyString = z.string().min(1);
export const isoTimestamp = z.iso.datetime({ offset: true });
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");

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
