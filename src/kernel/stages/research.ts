import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cacheKey, contradictions, fingerprint, type EnvFingerprint } from "../../adapter/env.js";
import { stateDir, writeArtifact } from "../../fs/layout.js";
import { parseArtifact } from "../../schemas/common.js";
import { researchBriefSchema, type ResearchBrief } from "../../schemas/records.js";
import { scrubJson } from "../scrub.js";
import type { Budgets } from "../../schemas/budgets.js";
import { researchDry, researchValid, upstreamBug, type KernelEvent } from "../events.js";

/**
 * T-045 — failure research with the env-keyed cache (X-6, D-18).
 *
 * The cache key is `sha256(signature | lockfile_hash | runtime_version)`: the
 * same error under a different dependency set or runtime is a different cause
 * until proven otherwise. A key hit additionally validates the brief's
 * `version_facts` against the current environment — any contradiction is a
 * miss (X-6). This supersedes the oracle's plain-signature cache, which keyed
 * on the error alone and would happily serve a brief from another world.
 *
 * A hit skips the research SESSION entirely (the launch, the tokens, the web
 * calls) — the research SLOT was already consumed on entry to RESEARCH, which
 * is why the oracle asserted `research_sessions == 1` on the cache-hit ticket
 * while asserting zero research calls.
 */

export function briefCachePath(root: string, key: string): string {
  return path.join(stateDir(root), "research", "failures", `${key}.json`);
}

export interface ResearchDeps {
  readonly root: string;
  /**
   * X-1 (PRDR-250): returns the session's OBSERVED turn count, which the stage
   * compares against `failure_research_tool_calls`. Turns are the proxy on
   * init's precedent (`src/init/pipeline.ts`): S-4's telemetry carries no
   * per-call counter, so a turn is one call's worth of budget (C-3a). A launch
   * suppressed by B-5's crash skip reports zero, because no session ran.
   */
  readonly launch: (inputs: Record<string, unknown>) => Promise<number>;
  readonly readArtifact: () => unknown;
  readonly readFailureSignature: () => string | null;
  /**
   * X-1 (PRDR-250): the budgets themselves, not a pre-extracted number. The
   * P6 oracle strips comments AND string literals before matching, so a module
   * that takes a handed-in figure cannot vouch for enforcing the ceiling it is
   * named for — the posture PRDR-179 closed for the sibling `init` key.
   */
  readonly budgets: Pick<Budgets, "failure_research_tool_calls">;
  readonly note: (text: string) => void;
  /** Injectable for determinism; defaults to the real T-021 fingerprint. */
  readonly env?: () => Promise<EnvFingerprint>;
  readonly ticketInputs: Record<string, unknown>;
}

export interface ResearchOutcome {
  readonly event: KernelEvent;
  /** Set when the brief names an upstream bug — the loop links a ticket. */
  readonly upstream?: ResearchBrief;
  readonly cached: boolean;
}

export async function researchStage(deps: ResearchDeps): Promise<ResearchOutcome> {
  const signature = deps.readFailureSignature();
  const env = await (deps.env ?? (() => fingerprint(deps.root)))();
  const key = signature === null ? null : cacheKey(signature, env);

  /** ---- cache read (D-18): key hit + version_facts agreement, else miss ----- */
  if (key !== null) {
    const file = briefCachePath(deps.root, key);
    if (existsSync(file)) {
      const parsed = parseArtifact(researchBriefSchema, JSON.parse(readFileSync(file, "utf8")));
      if (parsed.ok) {
        const disagreements = contradictions(parsed.value.version_facts, env);
        if (disagreements.length === 0) {
          deps.note(`research cache hit: ${key}`);
          if (parsed.value.upstream_bug !== undefined && parsed.value.upstream_bug !== "") {
            return { event: upstreamBug(parsed.value), upstream: parsed.value, cached: true };
          }
          return { event: researchValid(parsed.value, true), cached: true };
        }
        deps.note(`research cache MISS on version_facts contradiction: ${disagreements.join("; ")} (X-6)`);
      }
    }
  }

  /* ---- live session --------------------------------------------------------- */
  const ceiling = deps.budgets.failure_research_tool_calls;
  const turns = await deps.launch({
    ...deps.ticketInputs,
    tool_call_ceiling: ceiling,
    cache_key: key,
  });

  /**
   * X-1 (PRDR-250): the ceiling read back, before the brief is trusted.
   *
   * `tool_call_ceiling` reached the prompt and nothing ever compared anything to
   * it, so a session that ignored it had its brief accepted AND written to the
   * env-keyed cache on the same terms as one that stayed inside its budget —
   * seeding every later run from an unbounded session. The tokens are already
   * spent by here and this does not recover them; what it bounds is whether the
   * result is trusted, which is what RESEARCH_DRY is for.
   *
   * It does NOT refuse the ninth call, which is what the implementation plan's
   * AC asks. The only mechanism that could is a per-session turn ceiling, and
   * PRDR-106 removed those so that an SDK throw is unambiguously a crash rather
   * than a budget event; reintroducing one here would make an over-budget
   * research session indistinguishable from a transport death at the seam that
   * classifies crashes (S-4/PRDR-053).
   */
  if (turns > ceiling) {
    const detail = `research exceeded its tool-call ceiling: ${String(turns)} turns against ${String(ceiling)} (X-1)`;
    deps.note(detail);
    return { event: researchDry(detail), cached: false };
  }

  const raw = deps.readArtifact();
  const parsed = raw === null ? null : parseArtifact(researchBriefSchema, raw);
  if (parsed === null || !parsed.ok) {
    const detail = parsed === null ? "research produced no brief" : "research brief invalid (X-6a)";
    deps.note(detail);
    return { event: researchDry(detail), cached: false };
  }

  const brief = parsed.value;
  if (key !== null) {
    /**
     * SEC-4 (PRDR-252): through the F-1 seam, not a raw `writeFileSync`.
     *
     * `research/failures` is `tracking: "committed"`, and the brief is the
     * research session's own prose — it reads the repository with Read, Grep
     * and WebSearch and quotes what it finds into `root_cause.claim`,
     * `evidence[].claim` and four other free-string fields the schema shapes
     * but does not constrain. Written raw, an unscrubbed copy went to a path
     * `git add -A` stages, and stayed there: the cache is keyed by environment,
     * so every later run with the same signature serves the same bytes.
     *
     * `writeArtifact` scrubs, checks containment, and stamps — the F-2/F-3
     * guarantees this call had been bypassing along with the redaction.
     */
    const redacted = researchBriefSchema.parse(scrubJson(brief));
    writeArtifact(deps.root, path.posix.join("research", "failures", `${key}.json`), redacted);
  }

  if (brief.upstream_bug !== undefined && brief.upstream_bug !== "") {
    deps.note(`upstream bug: ${brief.upstream_bug}`);
    return { event: upstreamBug(brief), upstream: brief, cached: false };
  }
  return { event: researchValid(brief, false), cached: false };
}
