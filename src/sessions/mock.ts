import { type SessionBackend, type SessionResult, type SessionSpec } from "./backend.js";

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
        return await fn(spec);
      }
    }
    return okResult();
  }

  rolesLaunched(): string[] {
    return this.calls.map((c) => c.role);
  }

  callsFor(ticketId: string): RecordedCall[] {
    return this.calls.filter((c) => c.ticketId === ticketId);
  }
}

/** The spec is data the mock may inspect; exported for test convenience. */
