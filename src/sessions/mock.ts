import { type SessionBackend, type SessionResult, type SessionSpec } from "./backend.js";
import { existsSync, rmSync } from "node:fs";
import { guardToolUse } from "./guard.js";
import { parseResultMessage } from "./sdk.js";

/**
 * T-040 — the deterministic mock backend, porting the oracle's semantics.
 *
 * `script` maps `"<ticket>:<role>[:<n>]"` or `"<role>[:<n>]"` to a stage
 * function that performs side effects (write the artifact, edit files, git
 * commit) and returns telemetry. Per-key occurrence counters make `review:0`
 * then `review:1` scriptable; a missing entry defaults to a no-op success —
 * exactly the reference's behaviour, which several oracle tests rely on.
 */

export type StageFn = (spec: SessionSpec) => SessionResult | Promise<SessionResult>;

export interface RecordedCall {
  readonly ticketId: string;
  readonly role: string;
  readonly spec: SessionSpec;
}

export function okResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    ok: true,
    telemetryParsed: true,
    costEstimateUsd: 0.001,
    inputTokens: 80,
    outputTokens: 20,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    turns: 1,
    rawTail: "",
    ...overrides,
  };
}

/**
 * PRDR-188: a failure fixture DERIVED from the producer, never hand-built.
 *
 * `okResult({ ok: false, rawTail })` is a shape a test author invents.
 * Production derives both fields from the SDK's own result message through
 * `parseResultMessage`, and the two diverged: PRDR-187's defect sat in exactly
 * that gap — the hand-built shape was right for four hops and wrong at the
 * fifth, so a fix verified four ways was blind to the only case it existed for.
 *
 * Pass the SDK-shaped message a real session would return and get whatever
 * production would make of it, including the parts a fixture forgets: the
 * telemetry verdict, the crash flag, the tail.
 */
export function resultFromSdk(message: Record<string, unknown>): SessionResult {
  return parseResultMessage(message as never);
}

/** The shape a backend outage takes: an error result carrying its reason. */
export function outageResult(reason: string): SessionResult {
  return resultFromSdk({
    type: "result",
    subtype: "success",
    is_error: true,
    result: reason,
    total_cost_usd: 0,
    modelUsage: {},
    num_turns: 1,
  });
}

export class MockBackend implements SessionBackend {
  readonly name = "mock";
  /** Launch log, in order — the oracle's `calls`, with the full spec kept. */
  readonly calls: RecordedCall[] = [];
  private readonly perKey = new Map<string, number>();

  constructor(private readonly script: Readonly<Record<string, StageFn>> = {}) {}

  async checkVersion(): Promise<void> {
    /* The mock is version-free (oracle parity). */
  }

  async run(spec: SessionSpec): Promise<SessionResult> {
    this.calls.push({ ticketId: spec.ticketId, role: spec.role, spec });
    for (const key of [`${spec.ticketId}:${spec.role}`, spec.role]) {
      const n = this.perKey.get(key) ?? 0;
      const fn = this.script[`${key}:${n}`] ?? this.script[key];
      if (fn !== undefined) {
        this.perKey.set(key, n + 1);
        const result = await fn(spec);
        this.enforcePolicy(spec);
        return result;
      }
    }
    return okResult();
  }

  /**
   * PRDR-188: the fixture obeys the containment policy it is handed.
   *
   * Stage functions write artifacts with `fs`, so the mock never ran the
   * PreToolUse hook and every session-driving test in this suite was blind to
   * containment. Two defects lived behind that blindness: `init` was dead at
   * ANALYZE for two days because the SEC-3 floor denied `analysis.json`
   * (PRDR-184), and no read-only role could write its artifact in the default
   * worktree mode (PRDR-180). Both were fatal in production with the whole
   * suite green, and both were found by live runs rather than by tests.
   *
   * A production session that is denied its artifact does not get one, so the
   * phase fails on the missing file. The mock now reproduces exactly that: it
   * asks the REAL guard about the REAL policy the session arm published, and
   * removes an artifact the guard would not have permitted. Nothing else about
   * the fixture changes — a permitted write is left alone.
   *
   * Silent when no policy is published: a spec without one is a caller that
   * makes no containment claim, and inventing a verdict for it would be the
   * mock guessing.
   */
  private enforcePolicy(spec: SessionSpec): void {
    if (spec.policy === undefined || !existsSync(spec.artifactOut)) return;
    const decision = guardToolUse("Write", { file_path: spec.artifactOut }, spec.policy);
    if (decision.decision === "deny") rmSync(spec.artifactOut, { force: true });
  }

  rolesLaunched(): string[] {
    return this.calls.map((c) => c.role);
  }

  callsFor(ticketId: string): RecordedCall[] {
    return this.calls.filter((c) => c.ticketId === ticketId);
  }
}

/** The spec is data the mock may inspect; exported for test convenience. */
