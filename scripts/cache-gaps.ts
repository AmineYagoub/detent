import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIVE_MINUTE_P99_CEILING_S, type CacheLifetime } from "../src/schemas/cache-lifetime.js";
import { MODEL_PRICES, knownPrice, type ModelPrice } from "../src/sessions/prices.js";
import { runDirectly } from "./plan-corpus.js";

/**
 * S-6″ (PRDR-320) — the measurement behind the per-kind cache lifetimes in
 * `src/schemas/cache-lifetime.ts`, kept so the table can be measured again:
 *
 *   npx tsx scripts/cache-gaps.ts ~/.claude/projects/-Users-me-myproject
 *
 * Claude Code keeps a transcript per session under `~/.claude/projects/`, in a
 * directory named for the project's path with each `/` as `-`. A transcript
 * records each request to the model: when it started (the entry before it, the
 * prompt or a tool's result), the model, and its usage. Five minutes is cheaper
 * where requests come close together, since a five-minute write costs $5 a
 * million on Opus 5.5 against $8 at one hour; a request more than five minutes
 * after the one before it writes the whole prefix again. So each kind's gaps
 * decide its lifetime: a kind whose 99th-percentile gap reaches four minutes
 * is not given five, and one under it is given five only where five is cheaper.
 *
 * The costs are estimates from the transcript's own tokens, the main model's
 * only. The one-hour figure prices them as recorded; the five-minute figure
 * prices a request after a gap of more than five minutes as a rewrite of its
 * cached prefix. A transcript recorded at five minutes already holds those
 * rewrites, so on it the one-hour figure is high by them. Each kind's writes
 * at each lifetime are counted from the usage's own split, which is how a
 * session's lifetime is checked after the fact.
 */

/** A model the price table does not know is priced as Opus 5.5, and counted. */
const OPUS_5_5: ModelPrice = MODEL_PRICES["claude-opus-5-5"] ?? { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 };

/** The role each of init's tasks and planning's stages belongs to, so a kind reads as role and task. */
const ROLE_OF: Readonly<Record<string, string>> = {
  survey: "audit",
  triage: "audit",
  verify_claims: "audit",
  /* a claim check, as builds before PRDR-306 named it */
  verify_claim: "audit",
  decide: "spec_write",
  write: "spec_write",
  fix: "spec_write",
  review: "spec_review",
  verify: "spec_review",
  SLICE: "planner",
  PLAN: "planner",
  REVIEW_PLAN: "plan_review",
};

export interface TranscriptRequest {
  /** When the request started, in ms: the entry before it, else its own. */
  readonly start: number;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** The write, split by the lifetime it was written at. */
  readonly written: Readonly<Record<CacheLifetime, number>>;
}

export interface TranscriptSession {
  /** `role/task`, from the task or stage the session's first message names; `?/?` when it names none. */
  readonly kind: string;
  readonly requests: readonly TranscriptRequest[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c === "object" && c !== null && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join(" ");
}

/**
 * A Claude Code session transcript, one JSON entry a line, as its kind and its
 * requests; null when it holds none. A message split over several entries is
 * one request, read from its first. A `<synthetic>` message is Claude Code's
 * own note, a limit or an error, not a request to the model.
 */
export function parseTranscript(text: string): TranscriptSession | null {
  const entries = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        /* a torn last line is a session still writing; the rest still reads */
        return [];
      }
    });
  const first = entries.find((e) => e["type"] === "user");
  const named = first === undefined ? undefined : /"(?:task|stage)":\s*"([A-Za-z_]+)"/u.exec(textOf((first["message"] as { content?: unknown } | undefined)?.content))?.[1];
  const kind = named === undefined ? "?/?" : `${ROLE_OF[named] ?? "?"}/${named}`;
  const requests = new Map<string, TranscriptRequest>();
  let previous: number | null = null;
  for (const e of entries) {
    const at = typeof e["timestamp"] === "string" ? Date.parse(e["timestamp"]) : Number.NaN;
    const m = e["message"] as { id?: unknown; model?: unknown; usage?: Record<string, unknown> } | undefined;
    if (e["type"] === "assistant" && typeof m?.id === "string" && m.model !== "<synthetic>" && !requests.has(m.id)) {
      const u = m.usage ?? {};
      const split = (u["cache_creation"] ?? {}) as Record<string, unknown>;
      requests.set(m.id, {
        start: previous ?? at,
        model: typeof m.model === "string" ? m.model : "",
        input: num(u["input_tokens"]),
        output: num(u["output_tokens"]),
        cacheRead: num(u["cache_read_input_tokens"]),
        cacheWrite: num(u["cache_creation_input_tokens"]),
        written: { "5m": num(split["ephemeral_5m_input_tokens"]), "1h": num(split["ephemeral_1h_input_tokens"]) },
      });
    }
    if (e["type"] === "user" && Number.isFinite(at)) previous = at;
  }
  return requests.size === 0 ? null : { kind, requests: [...requests.values()] };
}

export interface KindReport {
  readonly kind: string;
  readonly sessions: number;
  readonly requests: number;
  /** Seconds between consecutive requests of one session. */
  readonly gaps: { readonly p50: number; readonly p90: number; readonly p99: number; readonly max: number };
  readonly over5m: number;
  readonly gapCount: number;
  /** Estimated main-model cost at each lifetime, in dollars. */
  readonly cost: Readonly<Record<CacheLifetime, number>>;
  /** The cache writes the transcripts recorded at each lifetime, in tokens. */
  readonly written: Readonly<Record<CacheLifetime, number>>;
  /** The lifetime the rule gives the kind. */
  readonly lifetime: CacheLifetime;
  /** Requests to a model the price table does not know, priced as Opus 5.5. */
  readonly unpriced: number;
}

function quantile(sorted: readonly number[], p: number): number {
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
}

/** S-6″'s rule: five minutes only under the ceiling at the 99th percentile, and only where it is cheaper. */
export function lifetimeFor(p99: number, cost: Readonly<Record<CacheLifetime, number>>): CacheLifetime {
  return p99 < FIVE_MINUTE_P99_CEILING_S && cost["5m"] < cost["1h"] ? "5m" : "1h";
}

/** One report per kind, the costliest first. */
export function reportKinds(sessions: readonly TranscriptSession[]): KindReport[] {
  const byKind = new Map<string, TranscriptSession[]>();
  for (const s of sessions) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const out: KindReport[] = [];
  for (const [kind, group] of byKind) {
    const gaps: number[] = [];
    const cost = { "5m": 0, "1h": 0 };
    const written = { "5m": 0, "1h": 0 };
    let requests = 0;
    let unpriced = 0;
    for (const s of group) {
      let previous: number | null = null;
      for (const r of [...s.requests].sort((a, b) => a.start - b.start)) {
        requests += 1;
        const known = knownPrice(r.model);
        if (known === undefined) unpriced += 1;
        const p = known ?? OPUS_5_5;
        const [pin, pout, pread, pw1h, pw5m] = [p.input, p.output, p.cacheRead, p.write1h, p.write5m].map((x) => x / 1e6) as [number, number, number, number, number];
        const gap = previous === null ? 0 : (r.start - previous) / 1000;
        if (previous !== null) gaps.push(gap);
        const base = r.input * pin + r.output * pout;
        cost["1h"] += base + r.cacheRead * pread + r.cacheWrite * pw1h;
        cost["5m"] += base + (gap > 300 ? (r.cacheRead + r.cacheWrite) * pw5m : r.cacheRead * pread + r.cacheWrite * pw5m);
        written["5m"] += r.written["5m"];
        written["1h"] += r.written["1h"];
        previous = r.start;
      }
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    const p99 = quantile(sorted, 0.99);
    out.push({
      kind,
      sessions: group.length,
      requests,
      gaps: { p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p99, max: sorted.at(-1) ?? 0 },
      over5m: gaps.filter((g) => g > 300).length,
      gapCount: gaps.length,
      cost,
      written,
      lifetime: lifetimeFor(p99, cost),
      unpriced,
    });
  }
  return out.sort((a, b) => b.cost["1h"] - a.cost["1h"]);
}

/** Every transcript in `dir`, as the table this script prints. */
export function gapTable(dir: string): string {
  const sessions = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => {
      const parsed = parseTranscript(readFileSync(path.join(dir, f), "utf8"));
      return parsed === null ? [] : [parsed];
    });
  const lines = [
    "| Kind | Sessions | Requests | Gaps: p50, p90, p99, max (s) | Over 5 min | Written at 5 min, 1 h | Cost at 1 h | Cost at 5 min | Change | Lifetime |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const k of reportKinds(sessions)) {
    const change = k.cost["1h"] === 0 ? 0 : (k.cost["5m"] / k.cost["1h"] - 1) * 100;
    lines.push(
      `| ${k.kind} | ${String(k.sessions)} | ${String(k.requests)} | ${[k.gaps.p50, k.gaps.p90, k.gaps.p99, k.gaps.max].map((g) => g.toFixed(0)).join(", ")} | ` +
        `${String(k.over5m)} of ${String(k.gapCount)} | ${String(k.written["5m"])}, ${String(k.written["1h"])} | $${k.cost["1h"].toFixed(2)} | $${k.cost["5m"].toFixed(2)} | ` +
        `${change >= 0 ? "+" : ""}${change.toFixed(1)}% | ${k.lifetime}${k.unpriced > 0 ? ` (${String(k.unpriced)} requests to an unknown model, priced as Opus 5.5)` : ""} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

if (runDirectly(import.meta.url)) {
  const dir = process.argv[2]?.replace(/^~(?=$|\/)/u, os.homedir());
  if (dir === undefined) {
    process.stderr.write("usage: npx tsx scripts/cache-gaps.ts <a project's transcripts directory>\n");
    process.exit(2);
  }
  process.stdout.write(gapTable(dir));
}
