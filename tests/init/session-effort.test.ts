import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { INIT_TICKET, launchInitSession, withInitJournal } from "../../src/init/session.js";
import type { SessionBackend, SessionResult } from "../../src/sessions/backend.js";
import { okResult } from "../../src/sessions/mock.js";
import { PROMPTS, repo } from "./plan-fixture.js";

/**
 * PRDR-299 (S-4⁵) — an init session records the effort it was routed to and
 * the effort it ran at, as a kernel session has since S-4‴ and S-4⁗.
 *
 * `init` routed every session a level and journaled a bare `start`, and the
 * level the backend observed arrived on the result and was dropped. S-5⁵ puts
 * the planner and all three specification roles at `max`, and the SDK
 * downgrades silently for a model that cannot serve a level, so a planner that
 * ran lower left a journal identical to one that ran at `max`.
 *
 * The backend here reports what `SdkBackend` reports: the level its hook saw,
 * or none.
 */

/** Writes the artifact and returns `result`, as a session that ran would. */
function reporting(result: Partial<SessionResult>): SessionBackend {
  return {
    name: "reporting",
    checkVersion: async () => {},
    run: async (spec) => {
      writeFileSync(spec.artifactOut, "{}\n");
      return okResult(result);
    },
  };
}

const events = (root: string): Record<string, unknown>[] => {
  const file = path.join(stateDir(root), "runs", INIT_TICKET, "journal.jsonl");
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
};

/** One `audit` session on a fresh repository, routed `effort` (none when undefined); what `init` said, and what it journaled. */
async function launch(result: Partial<SessionResult>, effort?: string): Promise<{ readonly notes: string[]; readonly events: Record<string, unknown>[] }> {
  const root = repo();
  const notes: string[] = [];
  await withInitJournal(root, async (journal) =>
    await launchInitSession(
      {
        root,
        backend: reporting(result),
        prompts: PROMPTS,
        spendCeiling: 100,
        journal,
        note: (text) => notes.push(text),
        ...(effort === undefined ? {} : { effortRouting: { audit: effort } }),
      },
      { role: "audit", inputs: {}, artifactOut: path.join(stateDir(root), "state", "audit-artifact.json") },
    ),
  );
  return { notes, events: events(root) };
}

const of = (all: readonly Record<string, unknown>[], event: string): Record<string, unknown>[] => all.filter((e) => e["event"] === event);

describe("PRDR-299 an init session records the effort it was routed to and the one it ran at (S-4⁵)", () => {
  it("AC 5: routed to max, the turns ran at high: `start` names max, `effort_settled` records both, and the downgrade is said", async () => {
    const { notes, events: all } = await launch({ effort: "high" }, "max");

    expect(of(all, "start")).toEqual([expect.objectContaining({ stage: "audit", effort: "max" })]);
    expect(of(all, "effort_settled")).toEqual([expect.objectContaining({ stage: "audit", routed: "max", active: "high" })]);
    expect(notes.filter((n) => n.startsWith("effort downgraded"))).toEqual([
      "effort downgraded (PRDR-237): audit is routed to max, and the model ran the turns at high — the SDK downgrades silently for a model that cannot serve a level",
    ]);
  });

  it("no level routed: `start` names `default`, and a level no tool call reported is `unobserved`, never agreement", async () => {
    const { notes, events: all } = await launch({});

    expect(of(all, "start")).toEqual([expect.objectContaining({ effort: "default" })]);
    expect(of(all, "effort_settled")).toEqual([expect.objectContaining({ routed: "default", active: "unobserved" })]);
    expect(notes.filter((n) => n.startsWith("effort downgraded"))).toEqual([]);
  });

  it("says nothing when the level held, when none was observed, or when none was routed", async () => {
    const held = await launch({ effort: "max" }, "max");
    const unseen = await launch({}, "max");
    const unrouted = await launch({ effort: "high" });

    expect(of(held.events, "effort_settled")).toEqual([expect.objectContaining({ routed: "max", active: "max" })]);
    expect(of(unseen.events, "effort_settled")).toEqual([expect.objectContaining({ routed: "max", active: "unobserved" })]);
    expect(of(unrouted.events, "effort_settled")).toEqual([expect.objectContaining({ routed: "default", active: "high" })]);
    expect([...held.notes, ...unseen.notes, ...unrouted.notes].filter((n) => n.startsWith("effort downgraded"))).toEqual([]);
  });

  it("a session that failed still records the level it ran at, before its phase is failed", async () => {
    const root = repo();
    const failing: SessionBackend = { name: "failing", checkVersion: async () => {}, run: async () => okResult({ ok: false, rawTail: "the model gave up", effort: "high" }) };

    const launched = withInitJournal(root, async (journal) =>
      await launchInitSession({ root, backend: failing, prompts: PROMPTS, spendCeiling: 100, journal, effortRouting: { audit: "max" } }, { role: "audit", inputs: {}, artifactOut: path.join(stateDir(root), "state", "audit-artifact.json") }),
    );

    await expect(launched).rejects.toThrow("audit session failed: the model gave up");
    expect(of(events(root), "effort_settled")).toEqual([expect.objectContaining({ routed: "max", active: "high" })]);
  });

  it("a routed model the runtime cannot serve is journaled and said, as a kernel session's is (PRDR-114)", async () => {
    const { notes, events: all } = await launch({ modelFallback: { requested: "claude-opus-5-5", reason: "model not available" } }, "max");

    expect(of(all, "model_fallback")).toEqual([expect.objectContaining({ stage: "audit", requested: "claude-opus-5-5", reason: "model not available" })]);
    expect(notes.filter((n) => n.startsWith("model fallback"))).toEqual([
      "model fallback (PRDR-114): audit is routed to claude-opus-5-5, unavailable on this runtime (model not available) — ran on the runtime default",
    ]);
  });

  it("the fallback's reason is a runtime string, scrubbed before the operator is told it (SEC-4)", async () => {
    const token = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const { notes, events: all } = await launch({ modelFallback: { requested: "claude-opus-5-5", reason: `runtime refused: token=${token}` } });

    expect(notes.filter((n) => n.startsWith("model fallback"))).toEqual([
      "model fallback (PRDR-114): audit is routed to claude-opus-5-5, unavailable on this runtime (runtime refused: token=[REDACTED]) — ran on the runtime default",
    ]);
    expect(JSON.stringify(all)).not.toContain(token);
  });
});
