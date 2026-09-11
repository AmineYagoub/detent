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

/**
 * D-28's ambient billable spawn tools, by every name the platform has shipped
 * them under: `Task` (classic subagent launcher), `Agent` (its successor),
 * `TaskCreate` (background-task spawn). T-124's live leg found a build whose
 * print-mode sessions expose only the newer names — an exact-match list
 * pinned to "Task" alone guarded yesterday's platform. Reads/controls
 * (TaskGet/TaskOutput/TaskStop) spawn nothing and stay allowed.
 *
 * D-28″ (PRDR-215): ONE list, read by the guard (both hook skins) and by the
 * kernel's published claim policy. It lives here, with the hook filenames,
 * because this is the one module all three may import — ARCH-1 keeps the
 * kernel out of `src/sessions/**`, and the audit of PRDR-215 found the first
 * placement, in the guard, refused by that very lint.
 */
export const SPAWN_TOOLS = ["Task", "Agent", "TaskCreate"] as const;
