import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-089 — vendored role variants, routed by the ticket's declared surface.
 *
 * The default set is unchanged for every project that configures nothing; a
 * routed ticket runs the variant; a typo routes to nothing rather than
 * stopping a run mid-ticket. The journal always names the prompt that ran.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function launchWith(routing: Record<string, Record<string, string[]>>, surface: string[]): Promise<{
  prefix: string;
  journal: Record<string, unknown>[];
  root: string;
}> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  addTicket(repo.root, { id: "t-1", surface });

  const configPath = path.join(stateDir(repo.root), "config.json");
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  writeFileSync(configPath, `${JSON.stringify({ ...raw, prompt_routing: routing }, null, 2)}\n`);

  const loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const journal = RunJournal.open(repo.root);
  cleanups.push(() => journal.close());
  const backend = new MockBackend({ implement: () => okResult() });
  const core = new RefereeCore(
    { root: repo.root, backend, prompts: loadPromptSet() },
    loaded,
    journal,
    ensureRunBranch(repo.root, "prompt-routing"),
  );
  installTrailerHook(repo.root);
  expect(core.acquire("t-1").ok).toBe(true);
  await core.attempt("t-1", "IN_PROGRESS");

  const events = readFileSync(path.join(stateDir(repo.root), "runs", "t-1", "journal.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { prefix: backend.calls[0]?.spec.promptPrefix ?? "", journal: events, root: repo.root };
}

describe("PRDR-089 role variants are opt-in and surface-routed", () => {
  it("no routing configured: the base prompt runs, unchanged", async () => {
    const { prefix, journal } = await launchWith({}, ["src/**"]);
    expect(prefix).toContain("You are the Implementer");
    expect(prefix).not.toContain("This repository is Go");
    expect(String(journal.find((e) => e["event"] === "start")?.["prompt"])).toMatch(/^implement@[0-9a-f]{64}$/);
  });

  it("a matching surface runs the variant, and the journal names it", async () => {
    const { prefix, journal } = await launchWith({ implement: { go: ["controlplane/**"] } }, ["controlplane/**"]);
    expect(prefix).toContain("This repository is Go");
    /** The contract survives specialization: the variant is still the Implementer. */
    expect(prefix).toContain("falsified");
    expect(prefix).toContain("surface-expansion request");
    expect(String(journal.find((e) => e["event"] === "start")?.["prompt"])).toMatch(/^implement\.go@[0-9a-f]{64}$/);
  });

  it("a non-matching surface falls back to the base prompt", async () => {
    const { prefix } = await launchWith({ implement: { go: ["controlplane/**"] } }, ["src/**"]);
    expect(prefix).not.toContain("This repository is Go");
  });

  it("S-6 pins the PROMPT, not the role: one role may carry two variants in a run", async () => {
    /**
     * The A/B's first live firing died here — `rememberPrefix` keyed on the
     * role, so a run whose implement sessions legitimately used two prompts
     * read as prompt drift and was killed as an S-6 violation.
     */
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-go", surface: ["main.go"] });
    addTicket(repo.root, { id: "t-ts", surface: ["src/**"] });

    const configPath = path.join(stateDir(repo.root), "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...raw, prompt_routing: { implement: { go: ["*.go"] } } }, null, 2)}\n`,
    );

    const loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({ implement: () => okResult() });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "s6-variants"),
    );
    installTrailerHook(repo.root);

    expect(core.acquire("t-go").ok).toBe(true);
    await core.attempt("t-go", "IN_PROGRESS");
    core.releaseTicket("t-go");
    expect(core.acquire("t-ts").ok).toBe(true);
    /** Two prompts, one role, one run — legal. */
    await expect(core.attempt("t-ts", "IN_PROGRESS")).resolves.not.toThrow();

    const prefixes = backend.calls.map((c) => c.spec.promptPrefix);
    expect(prefixes[0]).toContain("This repository is Go");
    expect(prefixes[1]).not.toContain("This repository is Go");
  });

  it("routing to a variant that does not exist is ignored, not fatal", async () => {
    const { prefix } = await launchWith({ implement: { cobol: ["src/**"] } }, ["src/**"]);
    expect(prefix).toContain("You are the Implementer");
  });
});
