import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { TOOL_NAMES, callTool } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

/**
 * T-106 — transport parity (ARCH-2).
 *
 * The MCP stdio server and the in-process registry are the SAME `callTool`;
 * this fixture proves it by driving an identical call sequence down both
 * paths on twin repositories and comparing every result — and the journaled
 * transitions — field for field (timestamps excepted: two wall clocks).
 *
 * This is the key-free half of the plugin-load story: the full Agent-SDK
 * `options.plugins` proof is T-114's live exit (MP1). What MP0 certifies is
 * that NOTHING in the referee's behavior depends on which side of a process
 * boundary the driver stands.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** The sequence both paths execute: pool → claim → admit → gate → admit → reads. */
const SEQUENCE: { name: string; input: (refs: Record<string, string>) => Record<string, unknown> }[] = [
  { name: "next", input: () => ({}) },
  { name: "claim", input: () => ({ op: "acquire", ticket_id: "t-1" }) },
  { name: "transition", input: (refs) => ({ ticket_id: "t-1", ref: refs["claimed"] ?? "" }) },
  { name: "gate", input: () => ({ ticket_id: "t-1" }) },
  { name: "transition", input: (refs) => ({ ticket_id: "t-1", ref: refs["gate"] ?? "" }) },
  { name: "status", input: () => ({}) },
  { name: "report", input: () => ({}) },
  { name: "bogus", input: () => ({}) },
];

function collectRef(step: string, result: Record<string, unknown>, refs: Record<string, string>): void {
  if (step === "claim" && typeof result["claimed_ref"] === "string") refs["claimed"] = result["claimed_ref"];
  if (step === "gate" && typeof result["ref"] === "string") refs["gate"] = result["ref"];
}

function journaledTransitions(root: string): Record<string, unknown>[] {
  return readFileSync(path.join(stateDir(root), "transitions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const row = JSON.parse(l) as Record<string, unknown>;
      /* two wall clocks; everything else must agree */
      delete row["at"];
      return row;
    });
}

describe("T-106 the stdio server and the in-process registry are one referee", () => {
  it("an identical sequence yields identical results and identical journals", { timeout: 60_000 }, async () => {
    /** Twin repositories: one driven over MCP stdio, one in-process. */
    const stdio = await makeRunRepo();
    const inproc = await makeRunRepo();
    cleanups.push(() => removeTree(stdio.root));
    cleanups.push(() => removeTree(inproc.root));
    addTicket(stdio.root, { id: "t-1" });
    addTicket(inproc.root, { id: "t-1" });

    /** ---- path A: a real spawned server, a real MCP client */
    const transport = new StdioClientTransport({
      command: path.join(ROOT, "node_modules", ".bin", "tsx"),
      args: [path.join(ROOT, "src", "cli", "referee.ts"), "--root", stdio.root, "--backend", "mock"],
      stderr: "pipe",
    });
    const client = new Client({ name: "t-106", version: "0.0.0" });
    await client.connect(transport);
    cleanups.push(() => client.close());

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());

    const overStdio: Record<string, unknown>[] = [];
    const stdioRefs: Record<string, string> = {};
    for (const step of SEQUENCE) {
      const outcome = await client.callTool({ name: step.name, arguments: step.input(stdioRefs) });
      const body = JSON.parse(
        ((outcome.content as { type: string; text: string }[])[0] as { text: string }).text,
      ) as Record<string, unknown>;
      collectRef(step.name, body, stdioRefs);
      overStdio.push(body);
      if (step.name === "bogus") expect(outcome.isError).toBe(true);
    }
    await client.close();

    /** ---- path B: the same sequence, in-process */
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(inproc.root), "config.json"), "utf8")));
    const journal = RunJournal.open(inproc.root);
    cleanups.push(() => journal.close());
    const runBranch = ensureRunBranch(inproc.root, "referee-test");
    installTrailerHook(inproc.root);
    const core = new RefereeCore(
      { root: inproc.root, backend: new MockBackend(), prompts: loadPromptSet() },
      loaded,
      journal,
      runBranch,
    );

    const inProcess: Record<string, unknown>[] = [];
    const inprocRefs: Record<string, string> = {};
    for (const step of SEQUENCE) {
      const body = (await callTool(core, step.name, step.input(inprocRefs))) as Record<string, unknown>;
      collectRef(step.name, body, inprocRefs);
      inProcess.push(body);
    }

    /** ---- parity: results and journals agree field for field */
    expect(overStdio).toEqual(inProcess);
    expect(journaledTransitions(stdio.root)).toEqual(journaledTransitions(inproc.root));
  });
});
