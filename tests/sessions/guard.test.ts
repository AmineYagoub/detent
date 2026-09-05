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

const edit = (file: string) => guardToolUse("Edit", { file_path: file }, POLICY);

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
    /** the SEC-3 lever */
    expect(readme.reason).toContain("surface_request.json");
  });

  it("test_denies_outside_worktree", () => {
    const outside = guardToolUse("Edit", { file_path: "/etc/hosts" }, POLICY);
    expect(outside.decision).toBe("deny");
    expect(outside.reason).toContain("outside the worktree");
    expect(guardToolUse("Read", { file_path: "../secrets.txt" }, POLICY).decision).toBe("deny");
  });

  it("a tool call naming no path is allowed — the kernel re-verifies regardless (P2)", () => {
    /**
     * S-2‴ (PRDR-122): these ABSTAIN rather than allow. A hook decision of
     * `allow` is terminal in the SDK's permission order, so answering it for a
     * pathless call overrode `allowedTools` — and `implement` is granted only
     * `Bash(git add:*)` and `Bash(git commit:*)`, while every other bash
     * command was being permitted by this very line.
     */
    expect(guardToolUse("Bash", {}, POLICY).decision).toBe("abstain");
    expect(guardToolUse("Write", null, POLICY).decision).toBe("abstain");
    expect(guardToolUse("Bash", { command: "git status" }, POLICY).decision).toBe("abstain");
    /** An MCP tool the guard does not govern is likewise the allowlist's call, not a grant. */
    expect(guardToolUse("mcp__serena__replace_symbol_body", { relative_path: "src/a.ts" }, POLICY).decision).toBe("abstain");
  });

  it("S-2″ (PRDR-068): reads are worktree-bounded, not surface-bounded — a session can read its spec", () => {
    /** T-140's empty-diff lesson: a worker denied READING the PRD cannot implement it. */
    expect(guardToolUse("Read", { file_path: "/wt/detent-prd-v3.md" }, POLICY).decision).toBe("abstain");
    expect(guardToolUse("Grep", { path: "/wt/README.md" }, POLICY).decision).toBe("abstain");
    /** SEC-3 is immutability, not unreadability. */
    expect(guardToolUse("Read", { file_path: "/wt/AGENTS.md" }, POLICY).decision).toBe("abstain");
    /** P7: the worktree bounds every tool, reads included. */
    expect(guardToolUse("Read", { file_path: "/etc/hosts" }, POLICY).decision).toBe("deny");
  });

  it("matchAny keeps the oracle's directory conveniences", () => {
    expect(matchAny("src/deep/nested.py", ["src/**"])).toBe(true);
    /** the bare directory */
    expect(matchAny("src", ["src/**"])).toBe(true);
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
    /** Read-only stages have no stop gate, even with a red command bound. */
    const review = await stopGate({ stage: "review", gateCmd: "sh -c 'exit 1'", stopHookActive: false }, red);
    expect(review.decision).toBe("allow");
    expect(READ_ONLY_STAGES.has("review")).toBe(true);
    /** stop_hook_active breaks hook-induced loops; the kernel judges from here. */
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
    /**
     * The decision function takes no allowlist at all: nothing a role is
     * granted can shadow the deny (D-21's whole point).
     */
    expect(edit("/wt/AGENTS.md").decision).toBe("deny");
  });
});

describe("S-1″ (PRDR-124): an init session's surface is its artifact, so its one write rule is real", () => {
  const initPolicy = {
    surface: [".detent/state/plan-draft.json"],
    protectedGlobs: [".detent/plan/**", ".detent/config.json", ".detent/bindings.json"],
    workRoot: "/wt",
  };

  it("the artifact is writable and nothing else in the repo is", () => {
    expect(guardToolUse("Write", { file_path: "/wt/.detent/state/plan-draft.json" }, initPolicy).decision).toBe("allow");
    /** The exact escape observed live: the draft written as parts beside the artifact. */
    const part = guardToolUse("Write", { file_path: "/wt/.detent/state/plan/s01-part1.json" }, initPolicy);
    expect(part.decision).toBe("deny");
    expect(part.reason).toContain("outside this ticket's declared surface");
    expect(guardToolUse("Write", { file_path: "/wt/src/anything.ts" }, initPolicy).decision).toBe("deny");
    expect(guardToolUse("Edit", { file_path: "/wt/detent-prd-v3.md" }, initPolicy).decision).toBe("deny");
  });

  it("reading is untouched — the surface governs writes alone", () => {
    /** A planner that cannot read the documents cannot analyse them (T-140's lesson). */
    expect(guardToolUse("Read", { file_path: "/wt/detent-prd-v3.md" }, initPolicy).decision).toBe("abstain");
    expect(guardToolUse("Grep", { path: "/wt/src" }, initPolicy).decision).toBe("abstain");
    /** The worktree bound still holds for reads. */
    expect(guardToolUse("Read", { file_path: "/etc/hosts" }, initPolicy).decision).toBe("deny");
  });
});
