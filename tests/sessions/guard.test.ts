import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  READ_ONLY_STAGES,
  guardToolUse,
  matchAny,
  realpathNearest,
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

/**
 * S-2⁗ (PRDR-127) — containment is judged on where a path LANDS.
 *
 * These stay hermetic by injecting the resolver, which is why it is a parameter
 * at all: `guardToolUse` was pure, and that purity is what lets the seven oracle
 * hook ports run with no session and no filesystem. The escapes themselves are
 * proved against real links on disk in the SEC pack.
 */
describe("S-2⁗ the resolved destination is what is judged (PRDR-127)", () => {
  it("uses the injected resolver: a path that RESOLVES outside the worktree is denied", () => {
    const escaping = (p: string): string => (p.startsWith("/wt/src/link") ? p.replace("/wt/src/link", "/elsewhere") : p);
    const decision = guardToolUse("Write", { file_path: "/wt/src/link/a.ts" }, POLICY, escaping);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("resolves through a symbolic link");
    /* Same call, nothing resolved: the lexical path is inside the surface. */
    expect(guardToolUse("Write", { file_path: "/wt/src/link/a.ts" }, POLICY, (p) => p).decision).toBe("allow");
  });

  it("a link that lands on a PROTECTED path is denied, and the reason names both paths", () => {
    const toProtected = (p: string): string => (p === "/wt/src/cfg" ? "/wt/AGENTS.md" : p);
    const decision = guardToolUse("Write", { file_path: "/wt/src/cfg" }, POLICY, toProtected);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("AGENTS.md is protected");
    expect(decision.reason).toContain("reached through a symbolic link from src/cfg");
  });

  it("a resolver that throws denies — containment that cannot be established has not passed", () => {
    const broken = (): string => {
      throw new Error("EIO");
    };
    const decision = guardToolUse("Write", { file_path: "/wt/src/a.ts" }, POLICY, broken);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("containment cannot be established");
  });

  it("resolution is invisible when nothing is a link — every decision above is unchanged", () => {
    expect(guardToolUse("Edit", { file_path: "/wt/src/calc.py" }, POLICY, (p) => p).decision).toBe("allow");
    expect(guardToolUse("Edit", { file_path: "/wt/AGENTS.md" }, POLICY, (p) => p).decision).toBe("deny");
    expect(guardToolUse("Edit", { file_path: "/etc/hosts" }, POLICY, (p) => p).decision).toBe("deny");
  });

  it("realpathNearest falls back to the lexical path when no ancestor exists — the fictional root above still works", () => {
    expect(realpathNearest("/wt/.detent/state/plan-draft.json")).toBe("/wt/.detent/state/plan-draft.json");
  });

  /**
   * PRDR-131a: this assertion used to be `realpathNearest("/tmp")` against
   * `realpathNearest("/private/tmp")`, which holds only where `/tmp` IS a link —
   * macOS. On Linux, where CI runs, `/tmp` resolves to itself and `/private`
   * does not exist, so the two differ and the assertion failed. The property
   * worth asserting is that a link and its target resolve alike; building the
   * link makes that true everywhere instead of true where it was written.
   */
  it("realpathNearest follows a link to its target — asserted on a link the test builds, not on the host's /tmp layout", () => {
    const base = mkdtempSync(path.join(tmpdir(), "detent-rp-"));
    try {
      mkdirSync(path.join(base, "target"));
      symlinkSync(path.join(base, "target"), path.join(base, "link"));
      expect(realpathNearest(path.join(base, "link", "file.txt"))).toBe(realpathNearest(path.join(base, "target", "file.txt")));
      /* And the link resolves to the target rather than to itself. */
      expect(realpathNearest(path.join(base, "link"))).toBe(realpathNearest(path.join(base, "target")));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

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

  it("a tool call naming no path ABSTAINS — the allowlist decides, and an `allow` here overrode it (S-2‴)", () => {
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

/**
 * S-3⁵ (PRDR-213) — `git rm` is the third verb, judged per pathspec like a write.
 *
 * Nothing a write session had removed a file: Write and Edit create and change,
 * and its Bash was `git add` and `git commit`. gate-313's bootstrap spent all
 * three review-fix attempts on a staged probe file no session could delete, and
 * the third committed it by accident. The verb is granted here and judged
 * exactly where a Write to the same path is judged — one plain path per token,
 * and a command the guard cannot read is DENIED, never left to the allowlist.
 */
describe("S-3⁵ (PRDR-213): `git rm` is the third verb, judged per pathspec like a write", () => {
  const bash = (command: string) => guardToolUse("Bash", { command }, POLICY);

  it("the write roles have three verbs; the read-only roles still have none", () => {
    for (const role of ["implement", "blind_fix", "informed_fix", "review_fix"]) {
      expect(toolsForRole(role), role).toContain("Bash(git rm:*)");
    }
    for (const role of ["review", "diagnose", "research", "planner"]) {
      expect(toolsForRole(role), role).not.toContain("Bash(git rm:*)");
    }
  });

  it("a plain path inside the surface is allowed; -f, -q, --cached and -- are read", () => {
    expect(bash("git rm -f src/calc.py").decision).toBe("allow");
    expect(bash("git rm --cached -q -- src/calc.py src/other.py").decision).toBe("allow");
    expect(bash("git rm -f /wt/src/calc.py").decision).toBe("allow");
  });

  it("outside the surface, on a protected path, or outside the worktree: the Write's own verdict", () => {
    const readme = bash("git rm -f README.md");
    expect(readme.decision).toBe("deny");
    expect(readme.reason).toContain("outside this ticket's declared surface");
    expect(bash("git rm -f AGENTS.md").reason).toContain("protected");
    expect(bash("git rm -f ../secrets.txt").reason).toContain("outside the worktree");
    /* One denied path denies the call: a foreign path cannot ride behind an owned one. */
    expect(bash("git rm -f src/calc.py README.md").decision).toBe("deny");
  });

  it("what the guard cannot read is DENIED, never abstained: -r, globs, magic, no pathspec, shell syntax", () => {
    const unreadable = [
      "git rm -r src",
      "git rm -f 'src/*.py'",
      "git rm -f src/*.py",
      "git rm -f :/src/calc.py",
      "git rm -f",
      "git rm",
      "git rm -f src/calc.py && rm -rf /",
      "git rm -f src/calc.py; ls",
      "git rm -f src/calc.py\nrm x",
      "git rm --dry-run src/calc.py",
      "git rm -f $(echo src/calc.py)",
      "git rm -f src/calc.py > /dev/null",
    ];
    for (const command of unreadable) {
      const decision = bash(command);
      expect(decision.decision, command).toBe("deny");
      expect(decision.reason, command).toContain("cannot read");
    }
  });

  it("every other bash call still abstains — the allowlist decides (S-2‴)", () => {
    expect(bash("git add src/calc.py").decision).toBe("abstain");
    expect(bash("git commit -m x").decision).toBe("abstain");
    expect(bash("rm -rf src").decision).toBe("abstain");
    expect(bash("git rmx src/calc.py").decision).toBe("abstain");
  });
});
