import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-092 — a run must not discard an operator's `.detent/config.json` edit.
 *
 * Observed in the field: `prompt_routing`, written into a tracked config as a
 * working-tree edit, applied for two tickets and then stopped — the file was
 * byte-identical to HEAD afterwards and `git status` read clean, so nothing
 * showed an edit had ever been made. The run simply behaved as though the
 * setting did not exist.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function configPath(root: string): string {
  return path.join(root, ".detent", "config.json");
}

function readRouting(root: string): unknown {
  return (JSON.parse(readFileSync(configPath(root), "utf8")) as { model_routing?: unknown }).model_routing;
}

describe("PRDR-092 an operator's config edit survives the run", () => {
  it("an uncommitted model_routing edit is still in effect after tickets finalize", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });

    /* The operator's edit: real key, never committed — exactly the field case. */
    const raw = JSON.parse(readFileSync(configPath(root), "utf8")) as Record<string, unknown>;
    writeFileSync(configPath(root), `${JSON.stringify({ ...raw, model_routing: { implement: "sentinel-model" } }, null, 2)}\n`);
    expect(readRouting(root)).toEqual({ implement: "sentinel-model" });
    expect(git(root, "status", "--short", ".detent/config.json").trim()).not.toBe("");

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "cfg-survives",
    });
    expect(outcome.exitCode).toBe(EXIT_OK);

    expect(readRouting(root)).toEqual({ implement: "sentinel-model" });
  });
});
