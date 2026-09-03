import { createHash } from "node:crypto";

/**
 * C-2⁗ (PRDR-117) — the production baseline.
 *
 * Detent plans for production even when the documents do not: a founder who
 * wrote a PRD about features did not write one about backups, and the plan
 * must not inherit that silence. SLICE places every applicable item into a
 * slice; a ticket derived from one traces to `baseline:PB-###` rather than to
 * a document, and the plan review accepts that provenance. `plan_baseline:
 * "none"` in config opts a project out, explicitly and in writing.
 */

export interface BaselineItem {
  readonly id: string;
  readonly category: "security" | "reliability" | "data" | "observability" | "operations" | "quality";
  readonly statement: string;
  /** When the item applies; SLICE skips an item whose condition the product does not meet, saying so. */
  readonly applies_when: string;
  /** What a ticket's acceptance criteria must assert for the item to count as delivered. */
  readonly verifiable_by: string;
}

export const PRODUCTION_BASELINE: readonly BaselineItem[] = [
  { id: "PB-001", category: "security", statement: "Secrets and credentials come from the environment or a secret store, never from source or logs.", applies_when: "always", verifiable_by: "a test or lint proving no secret literal in the repository and startup failing on a missing required secret" },
  { id: "PB-002", category: "security", statement: "Every network-facing entry point authenticates and authorises the caller; unauthenticated requests are rejected by default.", applies_when: "the product exposes an API, UI, or listener", verifiable_by: "a test that an unauthenticated request and an under-privileged request are both refused" },
  { id: "PB-003", category: "security", statement: "All external input is validated at the boundary with explicit limits (size, type, range); rejections are explicit, not crashes.", applies_when: "always", verifiable_by: "tests feeding malformed and oversized input to each entry point" },
  { id: "PB-004", category: "security", statement: "Dependencies are pinned and audited in the verification gate; a known-vulnerable dependency fails the gate.", applies_when: "always", verifiable_by: "a lockfile plus an audit step in the canonical gate" },
  { id: "PB-005", category: "reliability", statement: "Each long-running process exposes health and readiness, shuts down gracefully on signal, and bounds every outbound call with a timeout.", applies_when: "the product runs a server, worker, or daemon", verifiable_by: "tests for the health endpoint, a shutdown that drains in-flight work, and a timed-out dependency call" },
  { id: "PB-006", category: "reliability", statement: "Retried operations are idempotent, and retries use bounded backoff.", applies_when: "the product retries anything — queues, webhooks, remote calls", verifiable_by: "a test that a replayed operation has no second effect" },
  { id: "PB-007", category: "data", statement: "Persistent data is backed up on a schedule and the restore is exercised by a test or a documented drill.", applies_when: "the product stores data it cannot regenerate", verifiable_by: "a restore from backup that passes a verification query, automated or scripted" },
  { id: "PB-008", category: "data", statement: "Schema changes are versioned migrations that run forward automatically and have a stated rollback path.", applies_when: "the product owns a database schema", verifiable_by: "migrations applied from empty to current in the test gate, with each migration's down path stated" },
  { id: "PB-009", category: "observability", statement: "Logs are structured, carry a request or job id end to end, and never contain secrets or personal data beyond what the product documents.", applies_when: "always", verifiable_by: "a test asserting the log shape and the presence of the correlation id across one request" },
  { id: "PB-010", category: "observability", statement: "The golden signals — traffic, errors, latency, saturation — are measured, and an alert exists for each user-facing objective.", applies_when: "the product serves users or jobs continuously", verifiable_by: "metrics emitted under test and an alert definition per objective checked into the repository" },
  { id: "PB-011", category: "operations", statement: "Configuration is read from the environment, validated at startup, and documented; a bad configuration fails fast with the offending key named.", applies_when: "always", verifiable_by: "a startup test with a missing and an invalid key" },
  { id: "PB-012", category: "operations", statement: "The canonical verification gates run in continuous integration on every change, and a release is a recorded, reversible step.", applies_when: "always", verifiable_by: "a CI definition invoking the exact gate commands and a documented rollback" },
  { id: "PB-013", category: "operations", statement: "A runbook covers the three most likely failures with detection, diagnosis, and recovery steps.", applies_when: "the product is operated by anyone", verifiable_by: "the runbook exists, is referenced from the README, and each failure names a detection signal" },
  { id: "PB-014", category: "quality", statement: "Every requirement id in the documents traces to at least one automated test, and the lint and type gates are clean.", applies_when: "always", verifiable_by: "the review's traceability check and green gates" },
  { id: "PB-015", category: "quality", statement: "The golden path — install, configure, run, verify — is documented and exercised from a clean checkout.", applies_when: "always", verifiable_by: "a fresh-clone script or CI job that follows the README to a green result" },
];

/** Folded into SLICE's digest, so a baseline edit re-slices (C-8). */
export function baselineDigest(): string {
  return createHash("sha256").update(JSON.stringify(PRODUCTION_BASELINE)).digest("hex");
}
