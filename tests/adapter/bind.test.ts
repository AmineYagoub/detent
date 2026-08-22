import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  acknowledgeSkip,
  bindAll,
  bindSlot,
  resolveChoice,
  type GateRunner,
} from "../../src/adapter/bind.js";
import { discover, plausible, type Candidate } from "../../src/adapter/discover/index.js";
import { bindingSchema } from "../../src/schemas/records.js";
import { removeTree, tmpTree } from "../helpers.js";

/** T-026 — binding execution, watch-mode rejection, ambiguity, skips (V-1, V-2). */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const NOW = () => "2026-08-18T09:00:00.000Z";

const pkg = (scripts: Record<string, string>) => ({
  "package.json": JSON.stringify({ name: "svc", scripts }, null, 2),
  "package-lock.json": "{}\n",
});

describe("T-026 execute before approve (V-1, P4)", () => {
  it("runs the candidate once and records the invocation that ran", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const seen: string[] = [];
    const runner: GateRunner = async (spec) => {
      seen.push(spec.command);
      return { ...okResult(spec.command), slot: spec.slot };
    };

    const outcome = await bindSlot("test", discover(root).candidates, { root, runner, now: NOW });
    expect(seen).toEqual(["npm run test"]);
    expect(outcome.kind).toBe("bound");
    if (outcome.kind !== "bound") throw new Error("unreachable");
    expect(outcome.binding.resolved).toBe("npm run test");
    expect(outcome.binding.executed_at).toBe(NOW());
    expect(outcome.binding.approved_by).toBe("auto");
    expect(bindingSchema.parse(outcome.binding)).toEqual(outcome.binding);
  });

  it("a command that runs and fails is still a usable binding", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const runner: GateRunner = async (spec) => ({ ...okResult(spec.command), green: false, exitCode: 1, normalizedExit: 1 });
    const outcome = await bindSlot("test", discover(root).candidates, { root, runner, now: NOW });
    expect(outcome.kind).toBe("bound");
  });

  it("passes CI=1 and the normalized command to the runner (V-4)", async () => {
    const root = tree(pkg({ test: "vitest" }));
    let seen: { command: string; env: Readonly<Record<string, string>> } | null = null;
    const runner: GateRunner = async (spec) => {
      seen = { command: spec.command, env: spec.env };
      return okResult(spec.command);
    };
    await bindSlot("test", discover(root).candidates, { root, runner, now: NOW });
    expect(seen!.command).toBe("npm run test -- --run");
    expect(seen!.env).toEqual({ CI: "1" });
  });
});

describe("T-026 watch-mode rejection (V-1)", () => {
  it("a candidate that never exits is rejected with an explanation, not bound", async () => {
    const root = tree(pkg({ test: "vitest --watch" }));
    const outcome = await bindSlot("test", discover(root).candidates, {
      root,
      timeoutMs: 250,
      now: NOW,
      normalize: () => ({ command: "sleep 30", env: {} }),
    });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.reason).toBe("watch-mode");
    expect(outcome.explanation).toContain("did not exit");
    expect(outcome.explanation).toContain("watch mode");
  });

  it("a candidate that cannot be executed at all is rejected as unrunnable", async () => {
    const root = tree(pkg({ test: "definitely_not_a_command_xyz" }));
    const outcome = await bindSlot("test", discover(root).candidates, {
      root,
      timeoutMs: 5_000,
      now: NOW,
      normalize: () => ({ command: "definitely_not_a_command_xyz", env: {} }),
    });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.reason).toBe("unrunnable");
    expect(outcome.explanation).toContain("could not be executed");
  });

  it("interpreter-wrapped absence is unrunnable, not a red gate (PRDR-076)", async () => {
    const root = tree(pkg({ test: "python -m build" }));
    const outcome = await bindSlot("test", discover(root).candidates, {
      root,
      timeoutMs: 5_000,
      now: NOW,
      normalize: () => ({
        command: `sh -c 'echo "/usr/bin/python3: No module named build" >&2; exit 1'`,
        env: {},
      }),
    });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.reason).toBe("unrunnable");
    expect(outcome.explanation).toContain("tooling absent");
  });

  it("a red gate that merely PRINTS an absence phrase still binds (green guard)", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const outcome = await bindSlot("test", discover(root).candidates, {
      root,
      timeoutMs: 5_000,
      now: NOW,
      normalize: () => ({ command: `sh -c 'echo "docs mention No module named foo"; exit 0'`, env: {} }),
    });
    expect(outcome.kind).toBe("bound");
  });
});

describe("T-026 ambiguity is an interrupt, never a guess (V-1)", () => {
  it("make test + npm test yields a structured choice event and executes nothing", async () => {
    const root = tree({
      ...pkg({ test: "vitest run" }),
      Makefile: "test:\n\techo hi\n",
    });
    let ran = 0;
    const runner: GateRunner = async (spec) => {
      ran += 1;
      return okResult(spec.command);
    };

    const outcome = await bindSlot("test", discover(root).candidates, { root, runner, now: NOW });
    expect(outcome.kind).toBe("choice-required");
    if (outcome.kind !== "choice-required") throw new Error("unreachable");
    expect(outcome.candidates.map((c) => c.resolved).sort()).toEqual(["make test", "npm run test"]);
    expect(ran).toBe(0);
  });

  it("the human's choice is still executed before it is approved", async () => {
    const root = tree({ ...pkg({ test: "vitest run" }), Makefile: "test:\n\techo hi\n" });
    const runner: GateRunner = async (spec) => okResult(spec.command);
    const choice = await bindSlot("test", discover(root).candidates, { root, runner, now: NOW });
    if (choice.kind !== "choice-required") throw new Error("expected a choice");

    const chosen = choice.candidates.find((c) => c.adapter === "make")!;
    const bound = await resolveChoice(choice, chosen, "alice", { root, runner, now: NOW });
    expect(bound.kind).toBe("bound");
    if (bound.kind !== "bound") throw new Error("unreachable");
    expect(bound.binding.resolved).toBe("make test");
    expect(bound.binding.approved_by).toBe("alice");
  });

  it("refuses a choice that was not on the table", async () => {
    const root = tree({ ...pkg({ test: "vitest run", lint: "eslint ." }), Makefile: "test:\n\techo hi\n" });
    const choice = await bindSlot("test", discover(root).candidates, { root, runner: async (s) => okResult(s.command), now: NOW });
    if (choice.kind !== "choice-required") throw new Error("expected a choice");
    const otherSlot = plausible(discover(root).candidates, "lint")[0]!;
    await expect(resolveChoice(choice, otherSlot, "alice", { root, now: NOW })).rejects.toThrow(/not among the choices/);
  });

  it("accepts an answer that came back through a checkpoint, not the same object", async () => {
    /**
     * C-5 interrupts batch at phase boundaries and resume from a checkpoint
     * (F-4), so the answer arrives in a later process. Reference identity
     * cannot survive that; value identity must.
     */
    const root = tree({ ...pkg({ test: "vitest run" }), Makefile: "test:\n\techo hi\n" });
    const choice = await bindSlot("test", discover(root).candidates, { root, runner: async (s) => okResult(s.command), now: NOW });
    if (choice.kind !== "choice-required") throw new Error("expected a choice");

    const roundTripped = JSON.parse(JSON.stringify(choice.candidates.find((c) => c.adapter === "make"))) as Candidate;
    const bound = await resolveChoice(choice, roundTripped, "alice", { root, runner: async (s) => okResult(s.command), now: NOW });
    expect(bound.kind).toBe("bound");
    if (bound.kind !== "bound") throw new Error("unreachable");
    expect(bound.binding.resolved).toBe("make test");
  });
});

describe("T-026 V-2 record", () => {
  it("provisional status is representable, for C-4's greenfield finalisation", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const outcome = await bindSlot("test", discover(root).candidates, {
      root,
      runner: async (s) => okResult(s.command),
      now: NOW,
      status: "provisional",
    });
    if (outcome.kind !== "bound") throw new Error("unreachable");
    expect(outcome.binding.status).toBe("provisional");
  });

  it("carries the package manager and the region hash from discovery", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const [candidate] = plausible(discover(root).candidates, "test");
    const outcome = await bindSlot("test", discover(root).candidates, { root, runner: async (s) => okResult(s.command), now: NOW });
    if (outcome.kind !== "bound") throw new Error("unreachable");
    expect(outcome.binding.pm).toBe("npm");
    expect(outcome.binding.config_hash).toBe(candidate?.config_hash);
  });
});

describe("T-026 skips and unbound slots (V-1)", () => {
  it("an unbound slot is reported, never invented", async () => {
    const root = tree(pkg({ test: "vitest run" }));
    const report = await bindAll(discover(root), { root, runner: async (s) => okResult(s.command), now: NOW });
    expect(report.unbound).toContain("e2e");
    expect(report.bindings.map((b) => b.slot)).toEqual(["test"]);
  });

  it("a skip records who acknowledged it and when", () => {
    const skip = acknowledgeSkip("e2e", "alice", NOW());
    expect(skip).toEqual({ slot: "e2e", acknowledged_by: "alice", at: NOW() });
    expect(() => acknowledgeSkip("e2e", "  ")).toThrow(/must name who/);
  });

  it("bindAll separates bindings, interrupts and unbound slots", async () => {
    const root = tree({
      ...pkg({ test: "vitest run", lint: "eslint ." }),
      Makefile: "test:\n\techo hi\n",
    });
    const report = await bindAll(discover(root), { root, runner: async (s) => okResult(s.command), now: NOW });
    expect(report.bindings.map((b) => b.slot)).toEqual(["lint"]);
    expect(report.interrupts.map((i) => i.slot)).toEqual(["test"]);
    expect([...report.unbound].sort()).toEqual(["build", "e2e", "test_single", "typecheck"]);
  });
});

describe("T-026 defaults", () => {
  it("the probe timeout is long enough to be a real run", () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

function okResult(command: string) {
  return {
    slot: "test" as const,
    command,
    cwd: "/nowhere",
    outcome: "exited" as const,
    green: true,
    exitCode: 0,
    signal: null,
    normalizedExit: 0,
    output: "",
    outputBytes: 0,
    truncated: false,
    durationMs: 1,
  };
}
