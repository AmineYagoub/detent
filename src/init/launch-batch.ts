/**
 * D-28′ (PRDR-203): launches gated ONCE, as one in-flight unit.
 *
 * D-25 evaluates the gate at launch, never mid-flight, and D-28 bounds the
 * overshoot at one in-flight session. C-4⁗″'s review draws are independent by
 * construction and will one day launch together, and launches that pass the
 * gate together all pass it at the same figure — so the bound is the batch,
 * `k` sessions, and it is the batch whether the draws run together or one after
 * another, or the bound would depend on scheduling.
 *
 * `passed` flips only AFTER the gate lets the first launch through. A refused
 * first launch leaves it false, so the next launch in the batch evaluates the
 * gate again against the same figure and is refused the same way: a batch the
 * gate refuses launches none of its sessions. A relaunch (C-4⁗) is not handed
 * the batch — it happens after its draw returned, and the figure has moved.
 *
 * Its own module because both sides of the seam need it — `session.ts`, which
 * evaluates the gate, and `plan-review.ts`, which forms the batch — and a
 * runtime import from the latter into the former closed an import cycle
 * through the kernel that took eight test files down at load.
 */
export interface LaunchBatch {
  passed: boolean;
}

export function newLaunchBatch(): LaunchBatch {
  return { passed: false };
}
