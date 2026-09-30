import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { run } from "../../src/kernel/run.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * S-5⁶ (PRDR-319) — `run` says, before its first session, which routed model
 * the bundled runtime cannot serve and which role still names a superseded
 * default. A config keeps its own routing (S-5′), so this informs and changes
 * nothing: the run goes on, and the session it launches is routed as the
 * config says.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function routed(routing: Readonly<Record<string, string>>): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  const file = path.join(stateDir(root), "config.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...config, model_routing: routing }, null, 2)}\n`);
  addTicket(root, { id: "t1" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "route");
  return root;
}

describe("S-5⁶ run names the routing's problems before its first session", () => {
  it("names a model the runtime cannot serve and a superseded default, before the first session, and runs as routed", async () => {
    const root = await routed({ implement: "claude-sonnet-5-5", review: "claude-opus-5" });
    const announced: string[] = [];
    let beforeFirst: string[] | null = null;
    const backend = new MockBackend({
      implement: (spec) => {
        beforeFirst ??= [...announced];
        expect(spec.model, "the config's routing is used as it is").toBe("claude-sonnet-5-5");
        return okResult();
      },
    });
    await run({ root, backend, prompts: PROMPTS, runId: "routing", maxTickets: 1, runtime: "2.1.280", announce: (t) => announced.push(t) });
    expect(backend.calls.length, "the run goes on").toBeGreaterThan(0);
    const said = (beforeFirst ?? []).join("\n");
    expect(said, "the unserved model, with the runtime").toContain("implement → claude-sonnet-5-5");
    expect(said).toContain("2.1.280");
    expect(said, "the superseded default, with its successor").toContain('"review": "claude-opus-5-5"');
  });

  it("says nothing when every routed model is served and none is superseded", async () => {
    const root = await routed({ implement: "claude-sonnet-5-5", review: "claude-opus-5-5" });
    const announced: string[] = [];
    await run({ root, backend: new MockBackend(), prompts: PROMPTS, runId: "quiet", maxTickets: 1, runtime: "2.1.285", announce: (t) => announced.push(t) });
    expect(announced.join("\n")).not.toMatch(/model routing/u);
  });
});
