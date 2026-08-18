import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, parseArtifact, upgradeHint } from "../../src/schemas/common.js";
import { ticketSchema } from "../../src/schemas/ticket.js";
import {
  approvalSchema,
  bindingSchema,
  checkpointSchema,
  dossierSchema,
  hypothesisSchema,
  planSchema,
  ledgerRowSchema,
  researchBriefSchema,
  reviewSchema,
  transitionLineSchema,
} from "../../src/schemas/records.js";

const AT = "2026-08-17T12:00:00.000Z";
const SIG = "a".repeat(64);

const validTicket = () => ({
  schema_version: SCHEMA_VERSION,
  id: "t-001",
  type: "feature" as const,
  title: "Add thing",
  description: "",
  acceptance_criteria: ["the thing exists"],
  state: "READY" as const,
  generations: [
    { index: 0, counters: {}, outcome: "in_flight" as const, started_at: AT },
  ],
});

describe("T-010 artifact schemas (A-1..A-8, F-3)", () => {
  it("a valid ticket parses and fills defaults", () => {
    const r = parseArtifact(ticketSchema, validTicket());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.surface).toEqual([]);
      expect(r.value.generations[0]!.counters.blind_fix_attempts).toBe(0);
    }
  });

  it("rejects invalid fixtures with field-level errors", () => {
    const r = parseArtifact(ticketSchema, { ...validTicket(), acceptance_criteria: [] });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "invalid") {
      expect(r.issues.join(" ")).toContain("acceptance_criteria");
    }
  });

  it("A-1 requires at least one generation (X-8)", () => {
    const r = parseArtifact(ticketSchema, { ...validTicket(), generations: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown keys", () => {
    const r = parseArtifact(ticketSchema, { ...validTicket(), sneaky: true });
    expect(r.ok).toBe(false);
  });

  it("F-3: a newer-schema artifact is refused with an upgrade hint, not read best-effort", () => {
    const r = parseArtifact(ticketSchema, { ...validTicket(), schema_version: SCHEMA_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("newer-schema");
      if (r.reason === "newer-schema") {
        expect(upgradeHint(r.found, r.supported)).toContain("Upgrade Detent");
      }
    }
  });

  it("A-5: style is not a finding — the tag set is closed", () => {
    const base = { schema_version: SCHEMA_VERSION, verdict: "changes" as const };
    expect(parseArtifact(reviewSchema, { ...base, changes: [{ tag: "correctness", finding: "off by one" }] }).ok).toBe(true);
    expect(parseArtifact(reviewSchema, { ...base, changes: [{ tag: "style", finding: "naming" }] }).ok).toBe(false);
  });

  it("A-5: a 'changes' verdict with no findings is invalid", () => {
    expect(parseArtifact(reviewSchema, { schema_version: SCHEMA_VERSION, verdict: "changes", changes: [] }).ok).toBe(false);
  });

  it("X-6a: a brief citing a URL must record a non-empty local_search", () => {
    const brief = (source: string, local: Record<string, string[]>) => ({
      schema_version: SCHEMA_VERSION,
      failure_signature: "sig",
      cache_key: SIG,
      root_cause: { claim: "x", confidence: "high" as const },
      evidence: [{ source, claim: "y" }],
      recommended_fix: { strategy: "do z" },
      what_would_falsify: "if not z",
      local_search: local,
    });
    expect(parseArtifact(researchBriefSchema, brief("https://docs.example/x", {})).ok).toBe(false);
    expect(parseArtifact(researchBriefSchema, brief("https://docs.example/x", { code_checked: ["src/a.ts"] })).ok).toBe(true);
    /** A brief citing only local sources needs no local_search entries. */
    expect(parseArtifact(researchBriefSchema, brief("src/a.ts", {})).ok).toBe(true);
  });

  it("V-2: a binding record carries status and provenance", () => {
    const r = parseArtifact(bindingSchema, {
      schema_version: SCHEMA_VERSION,
      slot: "test",
      adapter: "npm",
      ref: "scripts.test",
      resolved: "npm run test",
      config_hash: SIG,
      executed_at: AT,
      approved_by: "auto",
      status: "provisional",
    });
    expect(r.ok).toBe(true);
  });
});

describe("T-010 remaining artifact schemas (A-2, A-3, A-7, A-8)", () => {
  it("A-2: a plan's dependency edges must reference tickets it contains", () => {
    const base = { schema_version: SCHEMA_VERSION, tickets: ["t-1", "t-2"] };
    expect(parseArtifact(planSchema, { ...base, edges: [{ from: "t-1", to: "t-2" }] }).ok).toBe(true);
    const bad = parseArtifact(planSchema, { ...base, edges: [{ from: "t-1", to: "t-9" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.reason === "invalid") expect(bad.issues.join(" ")).toContain("t-9");
  });

  it("A-2: agent assignments must reference known tickets, and refs are unique", () => {
    const base = { schema_version: SCHEMA_VERSION, tickets: ["t-1"] };
    expect(parseArtifact(planSchema, { ...base, assignments: { "t-9": "implement" } }).ok).toBe(false);
    expect(parseArtifact(planSchema, { schema_version: SCHEMA_VERSION, tickets: ["t-1", "t-1"] }).ok).toBe(false);
  });

  it("A-2: approval records who, when, and the plan hash (C-7)", () => {
    expect(
      parseArtifact(approvalSchema, { schema_version: SCHEMA_VERSION, approved_by: "amine", at: AT, plan_hash: SIG }).ok,
    ).toBe(true);
    expect(
      parseArtifact(approvalSchema, { schema_version: SCHEMA_VERSION, approved_by: "amine", at: AT, plan_hash: "nope" }).ok,
    ).toBe(false);
  });

  it("A-3: a hypothesis needs file:line evidence and a predicted failure (X-4)", () => {
    const base = {
      schema_version: SCHEMA_VERSION,
      claim: "off by one in the cursor",
      repro_test: "npm test -- cursor",
      predicted_failure: "expected 5 to equal 4",
      status: "proposed" as const,
    };
    expect(parseArtifact(hypothesisSchema, { ...base, evidence: [{ file: "a.ts", line: 3, what: "here" }] }).ok).toBe(true);
    /** Prose is inadmissible: evidence cannot be empty. */
    expect(parseArtifact(hypothesisSchema, { ...base, evidence: [] }).ok).toBe(false);
  });

  it("A-7: a checkpoint is content-addressed to its inputs (F-4)", () => {
    const base = { schema_version: SCHEMA_VERSION, phase: "ANALYZE", outputs: {}, at: AT };
    expect(parseArtifact(checkpointSchema, { ...base, inputs_hash: SIG }).ok).toBe(true);
    expect(parseArtifact(checkpointSchema, { ...base, inputs_hash: "short" }).ok).toBe(false);
  });

  it("A-8: a dossier carries per-generation history (X-8)", () => {
    const r = parseArtifact(dossierSchema, {
      schema_version: SCHEMA_VERSION,
      ticket: "t-1",
      reason: "ladder exhausted",
      generations: [{ index: 0, counters: {} }, { index: 1, counters: { sessions: 3 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.generations).toHaveLength(2);
  });
});

describe("T-010 local-set records (F-1)", () => {
  it("a transition line records the triple, generation, and counters", () => {
    const line = {
      at: AT, ticket: "t-1", generation: 0,
      from: "IN_PROGRESS", event: "GATE_RED", to: "BLIND_FIX",
      evidence: "test:exit=1", counters: {},
    };
    expect(transitionLineSchema.safeParse(line).success).toBe(true);
    /** The vocabulary is closed: an event outside §7 cannot be logged. */
    expect(transitionLineSchema.safeParse({ ...line, event: "MADE_UP" }).success).toBe(false);
    expect(transitionLineSchema.safeParse({ ...line, to: "QUARANTINED" }).success).toBe(false);
  });

  it("a ledger row names cost as an estimate and can be flagged partial after a crash", () => {
    const row = {
      at: AT, ticket: "t-1", generation: 0, role: "implement",
      cost_estimate_usd: 0.42, input_tokens: 1000, output_tokens: 200, turns: 3,
    };
    const parsed = ledgerRowSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    /** PRDR-053: a crashed session is recorded as a flagged lower bound, not zero. */
    expect(ledgerRowSchema.safeParse({ ...row, partial: "crash" }).success).toBe(true);
    expect(ledgerRowSchema.safeParse({ ...row, partial: "whatever" }).success).toBe(false);
  });
});
