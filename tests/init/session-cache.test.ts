import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { launchInitSession, withInitJournal } from "../../src/init/session.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { EXTENDED_CACHE_HEADER } from "../../src/sessions/env.js";
import { okResult } from "../../src/sessions/mock.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { FIVE_MINUTE_KINDS, FIVE_MINUTE_P99_CEILING_S } from "../../src/schemas/cache-lifetime.js";
import type { RoleId } from "../../src/schemas/roles.js";
import { definitionText } from "../docs/prd-marks.js";
import { PROMPTS, repo } from "./plan-fixture.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

/**
 * S-6″ (PRDR-320) — each kind of session gets the cache lifetime its measured
 * gaps call for. S-6 asked for the extended lifetime on every session, and on
 * a subscription Claude Code picks one hour anyway: all 38.9M tokens
 * tabachir's test run wrote to the cache were written at one hour. A claim
 * check's requests come 12 seconds apart at the median, so five minutes would
 * have cost it 17% less; a review's long thinking turns outlast five minutes,
 * so five would cost it 11% more. A kind is the role and its task.
 */

/** What an init session of `role`, handed `inputs`, is launched with. */
async function specOf(role: RoleId, inputs: Record<string, unknown>): Promise<SessionSpec> {
  const root = repo();
  let seen: SessionSpec | null = null;
  const backend: SessionBackend = {
    name: "recording",
    checkVersion: async () => undefined,
    run: async (spec) => {
      seen = spec;
      writeFileSync(spec.artifactOut, "{}\n");
      return okResult();
    },
  };
  await withInitJournal(root, async (journal) =>
    await launchInitSession(
      { root, backend, prompts: PROMPTS, spendCeiling: 100, journal },
      { role, inputs, artifactOut: path.join(stateDir(root), "state", `${role}-artifact.json`) },
    ),
  );
  if (seen === null) throw new Error("no session was launched");
  return seen;
}

const envOf = (spec: SessionSpec): Record<string, string> =>
  (buildOptions(spec, { policy: { surface: ["**"], protectedGlobs: [], workRoot: spec.cwd } }).env ?? {}) as Record<string, string>;

const saved = { ...process.env };
afterEach(() => {
  for (const key of ["CLAUDE_CODE_PROMPT_CACHE_TTL", "ENABLE_PROMPT_CACHING_1H", "FORCE_PROMPT_CACHING_5M", "ANTHROPIC_CUSTOM_HEADERS"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("S-6″ a cache lifetime per kind of session", () => {
  it("gives the kinds measured to want five minutes five, and every other kind one hour", async () => {
    const kinds: readonly [RoleId, Record<string, unknown>, string][] = [
      ["audit", { task: "survey" }, "1h"],
      ["audit", { task: "triage" }, "1h"],
      ["audit", { task: "verify_claims" }, "5m"],
      ["spec_write", { task: "decide" }, "1h"],
      ["spec_write", { task: "write" }, "5m"],
      ["spec_write", { task: "fix" }, "5m"],
      ["spec_review", { task: "review" }, "1h"],
      ["spec_review", { task: "verify" }, "1h"],
      ["planner", { stage: "SLICE" }, "1h"],
      ["planner", { stage: "PLAN" }, "1h"],
      ["plan_review", { stage: "REVIEW_PLAN" }, "1h"],
    ];
    for (const [role, inputs, lifetime] of kinds) {
      expect((await specOf(role, inputs)).cacheTtl, `${role} ${JSON.stringify(inputs)}`).toBe(lifetime);
    }
  });

  it("every five-minute kind is a task init sends, so a renamed task cannot fall back to an hour unseen", () => {
    /* PRDR-306 renamed the claim check's task from verify_claim to verify_claims; a table left behind would give it an hour. */
    const sent = readdirSync(path.join(REPO, "src", "init"))
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...readFileSync(path.join(REPO, "src", "init", f), "utf8").matchAll(/\btask: "([a-z_]+)"/gu)].map((m) => m[1]));
    for (const [role, tasks] of Object.entries(FIVE_MINUTE_KINDS)) {
      for (const task of tasks ?? []) expect(sent, `${role}/${task}`).toContain(task);
    }
    expect(Object.values(FIVE_MINUTE_KINDS).flat().length).toBeGreaterThan(0);
  });

  it("S-6″ states the five-minute kinds and the ceiling as the code has them", () => {
    const text = (definitionText(readFileSync(path.join(REPO, "detent-prd-v3.md"), "utf8"), "S-6″")[0] ?? "").replace(/\s+/gu, " ");
    for (const task of Object.values(FIVE_MINUTE_KINDS).flat()) expect(text, String(task)).toContain(`\`${String(task)}\``);
    expect(text).toContain(`${String(FIVE_MINUTE_P99_CEILING_S)} seconds at the 99th percentile`);
    expect(text).toContain("`CLAUDE_CODE_PROMPT_CACHE_TTL`");
  });

  it("a claim check's session environment carries five minutes, a review's one hour, and only the hour carries S-6's header", async () => {
    const check = envOf(await specOf("audit", { task: "verify_claims" }));
    const review = envOf(await specOf("spec_review", { task: "review" }));
    expect(check["CLAUDE_CODE_PROMPT_CACHE_TTL"]).toBe("5m");
    expect(review["CLAUDE_CODE_PROMPT_CACHE_TTL"]).toBe("1h");
    expect(review["ANTHROPIC_CUSTOM_HEADERS"], "a one-hour session keeps S-6's header").toBe(EXTENDED_CACHE_HEADER);
    expect(check["ANTHROPIC_CUSTOM_HEADERS"], "a five-minute session does not need it").toBeUndefined();
  });

  it("a session launched with no kind named gets one hour, as every run role does", () => {
    const env = envOf({
      role: "implement",
      ticketId: "t1",
      promptPrefix: "p",
      promptVariable: "v",
      cwd: "/wt",
      artifactOut: "/wt/.detent/runs/t1/out.json",
      allowedTools: ["Read"],
      permissionMode: "",
      model: "",
    });
    expect(env["CLAUDE_CODE_PROMPT_CACHE_TTL"]).toBe("1h");
    expect(env["ANTHROPIC_CUSTOM_HEADERS"]).toBe(EXTENDED_CACHE_HEADER);
  });

  it("an operator's own lifetime is not inherited: the table is a measured choice", async () => {
    process.env["CLAUDE_CODE_PROMPT_CACHE_TTL"] = "5m";
    process.env["ENABLE_PROMPT_CACHING_1H"] = "1";
    process.env["FORCE_PROMPT_CACHING_5M"] = "1";
    const review = envOf(await specOf("spec_review", { task: "review" }));
    expect(review["CLAUDE_CODE_PROMPT_CACHE_TTL"]).toBe("1h");
    expect(review["ENABLE_PROMPT_CACHING_1H"]).toBeUndefined();
    expect(review["FORCE_PROMPT_CACHING_5M"]).toBeUndefined();
  });

  it("an operator's own custom headers still pass, on either lifetime (S-6)", async () => {
    process.env["ANTHROPIC_CUSTOM_HEADERS"] = "anthropic-beta: custom";
    expect(envOf(await specOf("audit", { task: "verify_claims" }))["ANTHROPIC_CUSTOM_HEADERS"]).toBe("anthropic-beta: custom");
    expect(envOf(await specOf("spec_review", { task: "review" }))["ANTHROPIC_CUSTOM_HEADERS"]).toBe("anthropic-beta: custom");
  });
});
