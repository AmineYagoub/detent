import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renderHookBundle } from "../../scripts/build-plugin.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * T-113 — the D-21 containment hook as a plugin hook (S-2′, SEC-6, D-29).
 *
 * The M0 guard tests (T-046, the seven oracle `test_hooks.py` semantics) ran
 * at the decision layer; here the SAME cases run against the shipped artifact
 * — `hooks/dist/detent-hook.cjs` spawned exactly as the platform spawns it
 * (payload JSON on stdin, decision JSON on stdout, exit 0) — which is the
 * oracle's original subprocess shape. One decision implementation, third skin.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "hooks", "dist", "detent-hook.cjs");

const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

/** A project dir with the referee-written surface/stage files (F-1 names). */
function work(files: Readonly<Record<string, string>> = {}): string {
  const root = tmpTree(files);
  trees.push(root);
  return root;
}

const SURFACE = JSON.stringify({
  surface: ["src/**", ".detent/out/**"],
  protected: ["AGENTS.md", ".detent/tickets/**", "tickets/**"],
});

function runRaw(raw: string): { readonly out: string; readonly code: number } {
  const res = spawnSync(process.execPath, [BUNDLE], { input: raw, encoding: "utf8" });
  expect(res.error).toBeUndefined();
  return { out: res.stdout.trim(), code: res.status ?? -1 };
}

function run(payload: unknown): { readonly out: string; readonly code: number } {
  return runRaw(JSON.stringify(payload));
}

function denyReason(out: string): string {
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

const pre = (cwd: string, toolInput: unknown): { readonly out: string; readonly code: number } =>
  run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: toolInput, cwd });

describe("T-113 PreToolUse over the bundle (T-046 oracle ports)", () => {
  it("test_allows_in_surface — silence, never an explicit allow (D-29 narrows only)", () => {
    const cwd = work({ ".detent/active_surface.json": SURFACE });
    expect(pre(cwd, { file_path: path.join(cwd, "src", "calc.py") })).toEqual({ out: "", code: 0 });
    expect(pre(cwd, { file_path: "src/calc.py" })).toEqual({ out: "", code: 0 });
  });

  it("test_denies_protected — with the SEC-3 immutability reason", () => {
    const cwd = work({ ".detent/active_surface.json": SURFACE });
    const denied = pre(cwd, { file_path: path.join(cwd, "AGENTS.md") });
    expect(denied.code).toBe(0);
    expect(denyReason(denied.out)).toContain("protected");
    expect(denyReason(pre(cwd, { file_path: "tickets/t1.json" }).out)).toContain("protected");
  });

  it("test_denies_out_of_surface_with_escape_hatch_hint", () => {
    const cwd = work({ ".detent/active_surface.json": SURFACE });
    const reason = denyReason(pre(cwd, { file_path: path.join(cwd, "README.md") }).out);
    expect(reason).toContain("surface");
    expect(reason).toContain("surface_request.json");
  });

  it("test_denies_outside_worktree", () => {
    const cwd = work({ ".detent/active_surface.json": SURFACE });
    expect(denyReason(pre(cwd, { file_path: "/etc/hosts" }).out)).toContain("outside the worktree");
    expect(denyReason(pre(cwd, { file_path: "../secrets.txt" }).out)).toContain("outside the worktree");
  });

  it("a tool call naming no path is allowed — the referee re-verifies regardless (P2)", () => {
    const cwd = work({ ".detent/active_surface.json": SURFACE });
    expect(pre(cwd, { command: "git status" })).toEqual({ out: "", code: 0 });
    expect(pre(cwd, null)).toEqual({ out: "", code: 0 });
  });

  it("ABSENT surface file is silence — the ambient hook has no opinion outside a Detent attempt", () => {
    const cwd = work();
    expect(pre(cwd, { file_path: "/etc/hosts" })).toEqual({ out: "", code: 0 });
  });

  it("PRESENT but unreadable surface fails closed (P5)", () => {
    const cwd = work({ ".detent/active_surface.json": "{not json" });
    expect(denyReason(pre(cwd, { file_path: path.join(cwd, "src", "a.ts") }).out)).toContain("fails closed");
  });

  it("a non-object surface document denies path'd writes — empty surface, deny-by-default", () => {
    const cwd = work({ ".detent/active_surface.json": "null" });
    expect(denyReason(pre(cwd, { file_path: path.join(cwd, "src", "a.ts") }).out)).toContain("surface");
  });

  it("malformed stdin is silence, never a crash (oracle line-for-line)", () => {
    expect(runRaw("{oops")).toEqual({ out: "", code: 0 });
    expect(runRaw("")).toEqual({ out: "", code: 0 });
  });

  it("an unknown hook event is silence", () => {
    expect(run({ hook_event_name: "SessionStart", cwd: work() })).toEqual({ out: "", code: 0 });
  });
});

const stop = (cwd: string, active = false): { readonly out: string; readonly code: number } =>
  run({ hook_event_name: "Stop", stop_hook_active: active, cwd });

describe("T-113 Stop gate over the bundle (T-046 oracle ports)", () => {
  it("test_blocks_stop_while_red — GATE RED with the command and output tail", () => {
    const cwd = work({ ".detent/stage.json": JSON.stringify({ stage: "implement", gate_cmd: "echo boom && exit 1" }) });
    const blocked = stop(cwd);
    expect(blocked.code).toBe(0);
    const parsed = JSON.parse(blocked.out) as { decision: string; reason: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain("GATE RED");
    expect(parsed.reason).toContain("echo boom && exit 1");
    expect(parsed.reason).toContain("boom");
  });

  it("test_allows_stop_when_green", () => {
    const cwd = work({ ".detent/stage.json": JSON.stringify({ stage: "implement", gate_cmd: "exit 0" }) });
    expect(stop(cwd)).toEqual({ out: "", code: 0 });
  });

  it("read-only stages have no stop gate, even with a red command bound", () => {
    const cwd = work({ ".detent/stage.json": JSON.stringify({ stage: "review", gate_cmd: "exit 1" }) });
    expect(stop(cwd)).toEqual({ out: "", code: 0 });
  });

  it("stop_hook_active breaks hook-induced loops WITHOUT running the gate", () => {
    const cwd = work({
      ".detent/stage.json": JSON.stringify({ stage: "implement", gate_cmd: "echo hit > marker.txt; exit 1" }),
    });
    expect(stop(cwd, true)).toEqual({ out: "", code: 0 });
    expect(existsSync(path.join(cwd, "marker.txt"))).toBe(false);
  });

  it("no stage file means no stop gate — accelerant, never the authority (P2)", () => {
    expect(stop(work())).toEqual({ out: "", code: 0 });
  });
});

describe("T-113 the shipped wiring", () => {
  it("staleness: hooks/dist/detent-hook.cjs byte-equals a fresh esbuild render", async () => {
    expect(readFileSync(BUNDLE, "utf8"), "hook bundle is stale — run `npm run plugin`").toBe(
      await renderHookBundle(),
    );
  });

  it("hooks.json registers both events as deterministic command hooks only (P2 forbids prompt/agent types)", () => {
    const parsed = JSON.parse(readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, readonly { matcher?: unknown; hooks: readonly { type: string; command: string; timeout?: number }[] }[]>;
    };
    expect(Object.keys(parsed.hooks).sort()).toEqual(["PreToolUse", "Stop"]);
    for (const matchers of Object.values(parsed.hooks)) {
      for (const matcher of matchers) {
        /** No matcher: P7's containment runs on EVERY tool call. */
        expect(matcher.matcher).toBeUndefined();
        for (const hook of matcher.hooks) {
          expect(hook.type).toBe("command");
          expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/dist/detent-hook.cjs");
        }
      }
    }
    /** The Stop hook outlives the default 60 s so the 900 s gate ceiling can run (X-1). */
    expect(parsed.hooks["Stop"]?.[0]?.hooks[0]?.timeout).toBe(900);
  });

  it("ARCH-1: the hook is below the boundary entirely — src/plugin/** imports nothing from the kernel", () => {
    for (const file of readdirSync(path.join(ROOT, "src", "plugin"))) {
      const source = readFileSync(path.join(ROOT, "src", "plugin", file), "utf8");
      expect(source, `${file} reaches into src/kernel — the hook is an accelerant, never the authority`).not.toMatch(
        /from "\.\.\/kernel\//,
      );
    }
  });
});
