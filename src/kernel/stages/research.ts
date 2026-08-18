import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cacheKey, contradictions, fingerprint, type EnvFingerprint } from "../../adapter/env.js";
import { stateDir } from "../../fs/layout.js";
import { parseArtifact } from "../../schemas/common.js";
import { researchBriefSchema, type ResearchBrief } from "../../schemas/records.js";
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
  readonly launch: (inputs: Record<string, unknown>) => Promise<void>;
  readonly readArtifact: () => unknown;
  readonly readFailureSignature: () => string | null;
  readonly toolCallCeiling: number;
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

  // ---- cache read (D-18): key hit + version_facts agreement, else miss -----
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

  // ---- live session ---------------------------------------------------------
  await deps.launch({
    ...deps.ticketInputs,
    tool_call_ceiling: deps.toolCallCeiling,
    cache_key: key,
  });

  const raw = deps.readArtifact();
  const parsed = raw === null ? null : parseArtifact(researchBriefSchema, raw);
  if (parsed === null || !parsed.ok) {
    const detail = parsed === null ? "research produced no brief" : "research brief invalid (X-6a)";
    deps.note(detail);
    return { event: researchDry(detail), cached: false };
  }

  const brief = parsed.value;
  if (key !== null) {
    const file = briefCachePath(deps.root, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(brief, null, 2)}\n`);
  }

  if (brief.upstream_bug !== undefined && brief.upstream_bug !== "") {
    deps.note(`upstream bug: ${brief.upstream_bug}`);
    return { event: upstreamBug(brief), upstream: brief, cached: false };
  }
  return { event: researchValid(brief, false), cached: false };
}
