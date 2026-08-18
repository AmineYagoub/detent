import { describe, expect, it } from "vitest";
import {
  READ_ONLY_STAGES,
  guardToolUse,
  matchAny,
  researchTools,
  stopGate,
  toolsForRole,
  type GuardPolicy,
} from "../../src/sessions/guard.js";

/**
 * T-046 — the containment guard (S-2/D-21, SEC-3). The seven oracle hook
 * tests (test_hooks.py) port here at the decision layer: the oracle ran them
 * as subprocess hooks over `active_surface.json`; the SDK backend registers
 * the same decisions as in-process PreToolUse/Stop callbacks, which is what
 * D-21 makes normative. The decisions are pure, so the ports need no session.
 */

const POLICY: GuardPolicy = {
  surface: ["src/**", ".detent/out/**"],
  protectedGlobs: ["AGENTS.md", ".detent/tickets/**", "tickets/**"],
  workRoot: "/wt",
};

const edit = (file: string) => guardToolUse({ file_path: file }, POLICY);

describe("T-046 PreToolUse guard (oracle test_hooks ports)", () => {
  it("test_allows_in_surface", () => {
    expect(edit("/wt/src/calc.py").decision).toBe("allow");
    expect(edit("src/calc.py").decision).toBe("allow");
  });

  it("test_denies_protected — criteria/rules edits denied with reason", () => {
    const rules = edit("/wt/AGENTS.md");
    expect(rules.decision).toBe("deny");
    expect(rules.reason).toContain("protected");
    expect(edit("/wt/.detent/tickets/t1.json").decision).toBe("deny");
    expect(edit("tickets/t1.json").decision).toBe("deny");
  });

  it("test_denies_out_of_surface_with_escape_hatch_hint", () => {
    const readme = edit("/wt/README.md");
    expect(readme.decision).toBe("deny");
    expect(readme.reason).toContain("surface");
    expect(readme.reason).toContain("surface_request.json"); // the SEC-3 lever
  });

  it("test_denies_outside_worktree", () => {
    const outside = guardToolUse({ file_path: "/etc/hosts" }, POLICY);
    expect(outside.decision).toBe("deny");
    expect(outside.reason).toContain("outside the worktree");
    expect(guardToolUse({ file_path: "../secrets.txt" }, POLICY).decision).toBe("deny");
  });

  it("a tool call naming no path is allowed — the kernel re-verifies regardless (P2)", () => {
    expect(guardToolUse({}, POLICY).decision).toBe("allow");
    expect(guardToolUse(null, POLICY).decision).toBe("allow");
    expect(guardToolUse({ command: "git status" }, POLICY).decision).toBe("allow");
  });

  it("matchAny keeps the oracle's directory conveniences", () => {
    expect(matchAny("src/deep/nested.py", ["src/**"])).toBe(true);
    expect(matchAny("src", ["src/**"])).toBe(true); // the bare directory
    expect(matchAny("AGENTS.md", ["AGENTS.md"])).toBe(true);
    expect(matchAny("srcx/file.py", ["src/**"])).toBe(false);
  });
});

describe("T-046 stop gate (oracle test_hooks ports)", () => {
  const red = async () => ({ green: false, outputTail: "FAIL tests/test_totals.py\nboom" });
  const green = async () => ({ green: true, outputTail: "ok" });

  it("test_blocks_stop_while_red", async () => {
    const decision = await stopGate({ stage: "implement", gateCmd: "sh scripts/test.sh", stopHookActive: false }, red);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("GATE RED");
    expect(decision.reason).toContain("sh scripts/test.sh");
  });

  it("test_allows_stop_when_green", async () => {
    const decision = await stopGate({ stage: "implement", gateCmd: "sh scripts/test.sh", stopHookActive: false }, green);
    expect(decision.decision).toBe("allow");
  });

  it("test_read_only_stage_and_loop_guard", async () => {
    // Read-only stages have no stop gate, even with a red command bound.
    const review = await stopGate({ stage: "review", gateCmd: "sh -c 'exit 1'", stopHookActive: false }, red);
    expect(review.decision).toBe("allow");
    expect(READ_ONLY_STAGES.has("review")).toBe(true);
    // stop_hook_active breaks hook-induced loops; the kernel judges from here.
    const looped = await stopGate({ stage: "implement", gateCmd: "sh -c 'exit 1'", stopHookActive: true }, red);
    expect(looped.decision).toBe("allow");
  });

  it("no gate command means no stop gate", async () => {
    expect((await stopGate({ stage: "implement", gateCmd: null, stopHookActive: false }, red)).decision).toBe("allow");
  });
});

describe("T-046 tool surfaces (S-3, oracle test_research_session_gets_domain_scoped_web_tools)", () => {
  it("research gets WebSearch plus a domain-scoped WebFetch per configured docs domain", () => {
    const tools = researchTools(["github.com", "nodejs.org"]);
    expect(tools).toContain("WebSearch");
    expect(tools).toContain("WebFetch(domain:github.com)");
    expect(tools).toContain("WebFetch(domain:nodejs.org)");
    expect(tools).toContain("Read");
  });

  it("write stages get no web tools; read-only stages get no write tools", () => {
    const write = toolsForRole("implement");
    expect(write.some((t) => t.includes("Web"))).toBe(false);
    expect(write).toContain("Edit");

    const readOnly = toolsForRole("review");
    expect(readOnly).toEqual(["Read", "Grep", "Glob"]);
  });

  it("allowlists are the surface, never the containment — the guard runs regardless of them", () => {
    // The decision function takes no allowlist at all: nothing a role is
    // granted can shadow the deny (D-21's whole point).
    expect(edit("/wt/AGENTS.md").decision).toBe("deny");
  });
});
