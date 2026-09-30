import { z } from "zod";
import { draftGlob } from "../schemas/common.js";

/**
 * A drafted ticket as a planning checkpoint holds it: a slice's cache
 * (`plan-slices.ts`) and a redraft the checks across the plan sent
 * (`plan-cross.ts`, PRDR-293). Each is read back and pushed straight into the
 * plan index, so each is validated rather than cast (C-8‴).
 *
 * F-3′ (PRDR-137): the fields a reader CASTS to `DraftedTicket`, validated.
 * The slice cache checked 3 of 11 while its header promised "a shape this does
 * not recognise is a miss, not a crash", so a cache from an older build, a
 * merge or a hand edit was a HIT that crashed `init` mid-PLAN with
 * `TypeError: t.provides is not iterable`. A key hashes what a draft READ and
 * not the code that read it, which is what lets an older checkpoint still
 * match its key.
 */
export const cachedTicketSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  slice: z.string(),
  depends_on: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).default([]),
  /** SEC-3″ (PRDR-330): a cached ticket holding a glob picomatch cannot match safely or as written misses. */
  surface: z.array(draftGlob).default([]),
  provides: z.array(z.unknown()).default([]),
  consumes: z.array(z.unknown()).default([]),
  /* A-1⁵: additive, so a slice cached before the fields existed still HITS. */
  requirement_ids: z.array(z.string()).default([]),
  baseline_ids: z.array(z.string()).default([]),
  criterion_ids: z.array(z.string()).default([]),
});
