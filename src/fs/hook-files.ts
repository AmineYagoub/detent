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

/**
 * PRDR-079: is this claim's holder verifiably gone? A host recorded on the
 * claim that is not THIS host makes pid liveness a lie — never breakable. A
 * legacy claim without a host keeps the single-machine assumption PRDR-078
 * recorded. Shared by `unclaim`, approve/requeue's guard, the pool's
 * crash-resume self-heal, and the Stop hook's reading of the run's driver
 * (PRDR-099), so every breaker answers identically. It lives here, beside the
 * hook files, because the hook bundle may import this module and not the
 * kernel's.
 */
export function claimBreakable(info: { readonly pid: number; readonly host?: string | undefined }, isAlive: (pid: number) => boolean, thisHost: string): boolean {
  if (info.host !== undefined && info.host !== thisHost) return false;
  return !isAlive(info.pid);
}

/**
 * PRDR-079 amendment: EPERM answers "exists". Signal-0 to a process you may
 * not signal (pid 1 on a CI runner) throws EPERM — the process is ALIVE.
 * Treating any throw as death made both breakers see privileged live
 * processes as stale.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * D-27‴ (PRDR-099): the referee that drives a plugin run, as `stage.json`
 * records it. `owner`, `pid` and `host` are a claim's own currency (PRDR-079),
 * so the Stop hook asks of it what a breaker asks of a claim. `session_id` and
 * `parents` tie it to the Claude session it serves: the session id Claude Code
 * started it under, and the pids it runs under, the nearest first — the
 * plugin's launcher and the Claude process above it.
 */
export interface StageDriver {
  readonly owner: string;
  readonly pid: number;
  readonly host: string;
  readonly session_id?: string;
  readonly parents?: readonly number[];
}
