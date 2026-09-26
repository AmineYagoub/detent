import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString } from "./common.js";

/**
 * C-2⁶, C-2¹³ (PRDR-283) — what WRITE's session writes beside the pack.
 *
 * The session writes the pack's documents at the pack's paths, and this
 * artifact says what became of each original it was given that is not at one
 * of them: rewritten into the pack, so code moves it to `archive/`, or kept as
 * context, a README or a runbook, which stays where it is. An original at one
 * of the pack's paths is rewritten in place or left as it was, and code tells
 * which by its bytes, so it is listed in neither. The session moves nothing:
 * `archive/` is outside its write surface.
 */
export const writeArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  /** The originals rewritten into the pack, by their paths as the inputs gave them. */
  archive: z.array(nonEmptyString),
  /** The originals kept as context documents, where they are. */
  context: z.array(nonEmptyString),
});
export type WriteArtifact = z.infer<typeof writeArtifactSchema>;
