/**
 * T-120/T-121 — the D-21 hook policy filenames, unchanged from the oracle's
 * `.orchestrator/` names. A dependency-free module on purpose: the plugin
 * hook bundle imports these spellings, and importing them via `layout.ts`
 * would drag the zod-backed schema layer into a script that runs on every
 * tool call (the MP2 ship audit measured that mistake at 526 KB vs 60 KB).
 * `layout.ts` re-exports them, so kernel-side code keeps one import surface.
 */

export const HOOK_SURFACE_FILE = "active_surface.json";
export const HOOK_STAGE_FILE = "stage.json";
