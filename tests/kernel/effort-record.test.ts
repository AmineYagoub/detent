import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunOptions } from "../../src/kernel/run.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

function opts(root: string, backend: MockBackend, over: Partial<RunOptions> = {}): RunOptions {
  return { root, backend, prompts: PROMPTS, runId: "test", ...over };
}

/**
 * PRDR-235 — a configured effort is recorded, not assumed to have been honoured.
 *
 * PRDR-197 mirrored the SDK's closed set of effort levels so a typo is refused
 * at config load, and justified that with: "the SDK downgrades silently for a
 * model that cannot serve one, which is why a configured effort is recorded
 * per session rather than assumed to have been honoured" (src/schemas/roles.ts).
 *
 * Nothing recorded it. The models half is fully observed — `models` on every
 * ledger row, a `model_fallback` event, a note on the ticket — so a reader can
 * always answer which model ran. For effort there was no answer at all, which
 * makes any experiment that raises it unfalsifiable: a run at `max` and a run
 * at the default leave identical records.
 */
describe("PRDR-235 the journal records the effort a run and a session were given", () => {
  function withEffort(root: string, effort_routing: Record<string, string>): void {
    const file = path.join(root, ".detent", "config.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...config, effort_routing }, null, 2));
  }

  function runEvents(root: string): Array<Record<string, unknown>> {
    const file = path.join(root, ".detent/runs/run/journal.jsonl");
    if (!existsSync(file)) return [];
    return file
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  }

  it("the run's config audit event names the effort_routing it loaded", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    withEffort(root, { implement: "max" });

    await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));

    const config = runEvents(root).find((e) => e["event"] === "config");
    expect(config).toBeDefined();
    /* PRDR-092's contract is "the run records the configuration it actually
     * loaded" — model_routing was there from the start, effort_routing was not. */
    expect(config!["model_routing"]).toBeDefined();
    expect(config!["effort_routing"]).toEqual({ implement: "max" });
  });

  it("a session's start event names the effort it was launched with", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    withEffort(root, { implement: "max" });

    await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));

    const events = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    const implement = events.find((e) => e["event"] === "start" && e["stage"] === "implement");
    expect(implement).toBeDefined();
    expect(implement!["effort"]).toBe("max");

    /* An unrouted role says so explicitly, so a reader distinguishes "ran at
     * the SDK default" from "this build did not record it". */
    const review = events.find((e) => e["event"] === "start" && e["stage"] === "review");
    expect(review).toBeDefined();
    expect(review!["effort"]).toBe("default");
  });
});
