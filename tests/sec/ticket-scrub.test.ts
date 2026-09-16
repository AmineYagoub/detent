import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTicket, writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { ticketPath } from "../../src/kernel/tickets/paths.js";
import { quarantineTicket } from "../../src/kernel/flake.js";
import { briefCachePath, researchStage, type ResearchDeps } from "../../src/kernel/stages/research.js";
import { cacheKey, type EnvFingerprint } from "../../src/adapter/env.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { stateDir } from "../../src/fs/layout.js";
import { REDACTED } from "../../src/kernel/scrub.js";
import { launchInitSession, type InitSessionDeps } from "../../src/init/session.js";
import { outageResult } from "../../src/sessions/mock.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { PROMPTS, repo } from "../init/plan-fixture.js";
import { removeTree, tmpTree } from "../helpers.js";
import type { GateResult } from "../../src/adapter/run.js";

/**
 * SEC-4 (PRDR-252) — the scrub seam is the WRITE, not the caller who remembers.
 *
 * PRDR-169 put scrubbing on `appendNote` and said why: "Here rather than at
 * today's four call sites because the next site that appends session text
 * should inherit it rather than remember it — the rule this audit chain has now
 * forgotten four times." The next site was `quarantineTicket`, which writes
 * through `createTicket` → `writeTicket`, a different seam. It forgot a fifth
 * time, and this time into the `description` field of a ticket in
 * `.detent/plan/` — which `fs/layout.ts` marks `tracking: "committed"` and
 * `stageAll` sweeps with `git add -A`.
 *
 * So the assertions below are on the BYTES ON DISK, not on a return value: a
 * secret that reaches the file has leaked whatever the API hands back.
 */

const KEY = "sk-ant-api03-Zx9QmT4vL8nR2wY6bK1cJ7hF3dG5sP0aE";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function tree(): string {
  const root = tmpTree({});
  roots.push(root);
  return root;
}

function onDisk(root: string, id: string): string {
  return readFileSync(ticketPath(root, id), "utf8");
}

/** The shape `filterFlake` hands a quarantine: a green rerun. */
function greenRerun(): GateResult {
  return {
    slot: "test",
    command: "npm test",
    cwd: "/nowhere",
    outcome: "exited",
    green: true,
    exitCode: 0,
    signal: null,
    normalizedExit: 0,
    output: "ok",
    outputBytes: 2,
    truncated: false,
    durationMs: 1,
  };
}

describe("SEC-4 a secret never reaches a ticket file", () => {
  it("a quarantine ticket's evidence is scrubbed — gate output goes to a COMMITTED path", () => {
    const root = tree();
    createTicket(root, { id: "t1", type: "feature", title: "ship it", acceptance_criteria: ["it works"] });

    quarantineTicket(
      root,
      "t1",
      {
        kind: "quarantine",
        result: greenRerun(),
        signature: "sig-1",
        /** What a failing gate echoed — `referee-gate.ts` scrubs this exact string on its own path. */
        firstOutput: `Error: auth failed\nANTHROPIC_API_KEY=${KEY}\n  at verify (src/auth.ts:12)`,
      } as const,
      { id: "t1-flake-1" },
    );

    const raw = onDisk(root, "t1-flake-1");
    expect(raw, "the key must not be in the file `git add -A` will stage").not.toContain(KEY);
    expect(raw, "and the record still says what was removed").toContain(REDACTED);
    expect(raw, "the surrounding evidence survives — a scrubbed record is still evidence").toContain("auth failed");
  });

  it("the seam is `writeTicket`, so every field inherits it — not `description` alone", () => {
    const root = tree();
    createTicket(root, {
      id: "t2",
      type: "bug",
      title: `crash after ${KEY}`,
      description: `the session logged ${KEY}`,
      acceptance_criteria: [`no request carries ${KEY}`],
      non_goals: [`rotating ${KEY}`],
    });

    const raw = onDisk(root, "t2");
    expect(raw, "title, description, acceptance_criteria and non_goals are one write").not.toContain(KEY);
    expect(raw.match(/\[REDACTED\]/g) ?? [], "each of the four occurrences").toHaveLength(4);
  });

  it("what `writeTicket` returns is what it wrote — no unscrubbed copy is handed back", () => {
    const root = tree();
    const created = createTicket(root, {
      id: "t3",
      type: "bug",
      title: "leak",
      description: `key ${KEY}`,
      acceptance_criteria: ["fixed"],
    });
    expect(created.description ?? "", "the return value carried the secret onward").not.toContain(KEY);
    expect(created, "and it agrees with the file").toEqual(readTicket(root, "t3"));
  });

  /**
   * PRDR-177 loosened the assignment rule so a redactor could not mangle
   * compiler errors and operator guidance, and named the two cases below. It
   * also named what it deliberately did NOT loosen: "a purely numeric value
   * still redacts, so telemetry prose reads `tokens: [REDACTED] in, 4211 out`".
   * The control asserts the promise that was made, not the one that was not.
   */
  it("ordinary prose is untouched (PRDR-177: a redactor that mangles evidence is one nobody trusts)", () => {
    const root = tree();
    const prose = "Unexpected token: identifier, near the token: refresh path";
    writeTicket(root, {
      ...createTicket(root, { id: "t4", type: "bug", title: "parser", acceptance_criteria: ["parses"] }),
      description: prose,
    });
    expect(readTicket(root, "t4").description ?? "").toBe(prose);
  });
});

describe("SEC-4 a secret never reaches the per-ticket journal", () => {
  it("`appendTicketEvent` scrubs, which is the gap its own doc-block records", () => {
    const root = tree();
    const journal = RunJournal.open(root);
    try {
      journal.appendTicketEvent("t1", { stage: "ANALYZE", event: "end", ok: true, tail: `wrote ${KEY} to config` });
    } finally {
      journal.close();
    }

    const raw = readFileSync(path.join(stateDir(root), "runs", "t1", "journal.jsonl"), "utf8");
    expect(raw, "a probe found a 363-character effort_settled.active carrying a credential").not.toContain(KEY);
    expect(raw).toContain(REDACTED);
    /* Still a JSON line: scrubbing must not be able to tear the record. */
    expect(() => JSON.parse(raw.trim()) as unknown).not.toThrow();
    expect((JSON.parse(raw.trim()) as { stage: string }).stage).toBe("ANALYZE");
  });
});

describe("SEC-4 a failing init session does not shout its own tail verbatim", () => {
  /**
   * `referee-session.ts` scrubs this exact value — "SEC-4 (PRDR-169): rawTail
   * is the model's own final message" — before it becomes a note. `init`, which
   * has no fixture path and runs first in a project's life, threw it raw, and
   * `cli/init.ts` prints it as `init failed: ...`. A throw is the one place a
   * write seam cannot cover.
   */
  it("the thrown message carries the reason without the credential in it", async () => {
    const root = repo();
    roots.push(root);
    const journal = RunJournal.open(root);
    /* PRDR-188: the failure is DERIVED from the SDK shape, not hand-built. */
    const backend: SessionBackend = {
      name: "failing",
      checkVersion: async () => {},
      run: async () => outageResult(`refused: ANTHROPIC_API_KEY=${KEY} is not valid`),
    };
    const deps: InitSessionDeps = { root, backend, prompts: PROMPTS, spendCeiling: 0, journal };
    try {
      await expect(
        launchInitSession(deps, {
          role: "planner",
          inputs: {},
          artifactOut: path.join(stateDir(root), "state", "planner.json"),
        }),
      ).rejects.toThrow(/refused/);
      await launchInitSession(deps, {
        role: "planner",
        inputs: {},
        artifactOut: path.join(stateDir(root), "state", "planner.json"),
      }).catch((err: unknown) => {
        expect((err as Error).message, "the operator still learns why").toContain("refused");
        expect((err as Error).message, "without the credential").not.toContain(KEY);
        expect((err as Error).message).toContain(REDACTED);
      });
    } finally {
      journal.close();
    }
  });
});

describe("X-5 a quarantine ticket's evidence is bounded, not just scrubbed", () => {
  it("keeps the last 4000 characters, the bound `recordFailure` already used", () => {
    const root = tree();
    createTicket(root, { id: "t5", type: "feature", title: "ship it", acceptance_criteria: ["it works"] });
    const noisy = `${"log line\n".repeat(9000)}THE ACTUAL FAILURE`;

    quarantineTicket(
      root,
      "t5",
      { kind: "quarantine", result: greenRerun(), signature: "sig-5", firstOutput: noisy } as const,
      { id: "t5-flake-1" },
    );

    const description = readTicket(root, "t5-flake-1").description ?? "";
    const evidence = description.slice(description.indexOf("Failing output:\n") + "Failing output:\n".length);
    expect(evidence.length, "bounded on the same terms as the local failure record").toBe(4000);
    expect(evidence, "and the bound keeps the TAIL — where the failure is").toContain("THE ACTUAL FAILURE");
    expect(noisy.length, "the fixture is genuinely over the bound").toBeGreaterThan(4000);
  });
});

/**
 * SEC-4 (PRDR-252) — the research brief cache is a COMMITTED path.
 *
 * `fs/layout.ts` marks `research/failures` and `research/planning`
 * `tracking: "committed"`, and `stageAll` excludes only the LOCAL set. The
 * brief is the research session's own write-up: it reads the repository with
 * Read, Grep and WebSearch and quotes what it finds into `root_cause.claim`,
 * `evidence[].claim` and four other fields the schema shapes but does not
 * constrain. Written raw, an unscrubbed copy went to a path `git add -A`
 * stages — and stayed there, because the cache is keyed on the environment and
 * every later run with the same signature serves the same bytes.
 */
describe("SEC-4 a secret never reaches the research brief cache", () => {
  const ENV: EnvFingerprint = {
    ecosystems: [],
    lockfile_hash: "a".repeat(64),
    runtime_version: "node-24",
    version_facts: {},
  };

  it("the cached brief is scrubbed, and the brief the stage returns agrees with it", async () => {
    const root = tree();
    const signature = "ECONNREFUSED at auth";
    const key = cacheKey(signature, ENV);

    const deps: ResearchDeps = {
      root,
      launch: async () => 1,
      readFailureSignature: () => signature,
      env: async () => ENV,
      budgets: { failure_research_tool_calls: 8 },
      note: () => {},
      ticketInputs: {},
      readArtifact: () => ({
        schema_version: 1,
        failure_signature: signature,
        cache_key: key,
        root_cause: { claim: `the .env checked into the repo sets ANTHROPIC_API_KEY=${KEY}`, confidence: "high" },
        evidence: [{ source: ".env:3", claim: `ANTHROPIC_API_KEY=${KEY}` }],
        recommended_fix: { strategy: "rotate the key and read it from the environment" },
        what_would_falsify: "the gate passes with the variable unset",
        local_search: { docs_checked: ["README.md"], code_checked: [".env"] },
      }),
    };

    const outcome = await researchStage(deps);
    expect(outcome.cached, "a live session, not a cache hit").toBe(false);

    const raw = readFileSync(briefCachePath(root, key), "utf8");
    expect(raw, "the cache is under a tracking: committed path").not.toContain(KEY);
    expect(raw).toContain(REDACTED);
    expect(raw, "and the finding it was written for survives").toContain(".env:3");
  });
});
