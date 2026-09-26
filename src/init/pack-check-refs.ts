import {
  CATALOGUES_PATH,
  CATALOGUE_SECTIONS,
  CRITERION_REF,
  FACTS_PATH,
  PRD_INDEX_PATH,
  REQUIREMENT_REFS,
  type CatalogueKind,
  type PackFinding,
} from "../schemas/pack.js";
import { sections, type Line } from "./pack-markdown.js";
import { namedRequirements } from "./pack-parse.js";
import { finding, twice, type CheckContext } from "./pack-check-rules.js";

/**
 * C-2⁷, C-2¹⁰ (PRDR-280) — the checker's rules over text: every reference
 * resolves, every section a `§` names exists, every relative link reaches a
 * file, and every catalogue entry a document uses is in its catalogue.
 *
 * A document is scanned as one text with its fenced blocks blank, so a use
 * that wraps onto the next line of a bullet is still one use, and an example
 * in a fence is never read as one.
 *
 * Context documents (a README, a runbook) are read for requirement and
 * criterion ids and for links only: the pack's other ids are short enough
 * (`D-9`, `X-4`, `§4`) that a document written for something else uses them
 * for something else.
 */

interface Text {
  readonly body: string;
  /** The document's line number at an offset of `body`. */
  readonly lineAt: (offset: number) => number;
}

const read = new WeakMap<readonly Line[], Text>();

function textOf(lines: readonly Line[]): Text {
  const cached = read.get(lines);
  if (cached !== undefined) return cached;
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length + 1;
  }
  const text = {
    body: lines.map((l) => l.text).join("\n"),
    lineAt: (o: number) => {
      let [lo, hi] = [0, starts.length - 1];
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if ((starts[mid] ?? 0) <= o) lo = mid;
        else hi = mid - 1;
      }
      return lines[lo]?.n ?? 0;
    },
  };
  read.set(lines, text);
  return text;
}

/** Every match of `pattern` in `text`, each with the line it starts on. `pattern` is copied, so no caller's `lastIndex` moves. */
function* scan(text: Text, pattern: RegExp): Generator<{ readonly m: RegExpExecArray; readonly line: number }> {
  for (const m of text.body.matchAll(new RegExp(pattern.source, "gu"))) yield { m, line: text.lineAt(m.index) };
}

const texts = (ctx: CheckContext, typedOnly: boolean) =>
  [...ctx.lines].filter(([file]) => !typedOnly || ctx.typed.has(file)).map(([file, lines]) => ({ file, text: textOf(lines) }));

const quoted = (ids: readonly string[]) => ids.map((id) => `\`${id}\``).join(", ");

/* ---------------------------------------------------------------------------
 * References
 */

export const DECISION_REF = /(?<![\w-])([DX])-(\d+)\b/u;
export const FACT_REF = /\b(?:verified-)?facts(?:\.md)?\s+§\s?(\d+(?:\.\d+)?)(?:\s*[–—-]\s*§?\s?(\d+(?:\.\d+)?))?/u;

export function references(ctx: CheckContext): PackFinding[] {
  const { pack, refused } = ctx;
  const registered = new Set(pack.codes.map((c) => c.code));
  const defined = new Set([...pack.requirements.map((r) => r.id), ...pack.criteria.map((c) => c.id), ...refused]);
  const decisions = new Set([...pack.decisions.map((d) => d.id), ...pack.defaults.map((d) => d.id), ...refused]);
  const facts = new Set([...pack.facts.map((f) => f.id), ...refused]);
  const factSections = new Set(pack.documents.find((d) => d.path === FACTS_PATH)?.sections ?? []);
  const out: PackFinding[] = [];
  for (const { file, text } of texts(ctx, false)) {
    const context = !ctx.typed.has(file);
    const unknown = (ids: readonly string[]) => ids.filter((id) => !defined.has(id) && (!context || registered.has(id.split("-")[0] ?? "")));
    for (const { m, line } of [...scan(text, REQUIREMENT_REFS), ...scan(text, CRITERION_REF)]) {
      const missing = unknown(m[0].includes("-AC-") ? [m[0]] : namedRequirements(m[0]));
      if (missing.length > 0) out.push(finding("reference", { file, line }, `${quoted(missing)}: named here and defined nowhere in the pack`));
    }
    if (context) continue;
    for (const { m, line } of scan(text, DECISION_REF)) {
      if (!decisions.has(m[0])) out.push(finding("reference", { file, line }, `\`${m[0]}\`: no such ${m[1] === "D" ? "decision" : "default"} in docs/founder-decisions.md`));
    }
    for (const { m, line } of scan(text, FACT_REF)) {
      const missing = [m[1], m[2]].filter((id): id is string => id !== undefined && !resolvesFact(id, facts, factSections));
      for (const id of missing) out.push(finding("reference", { file, line }, `\`facts §${id}\`: no such fact in ${FACTS_PATH}`));
    }
  }
  return [...out, ...milestoneTags(ctx)];
}

/** `§N.M` is a fact's id; a bare `§N` is a numbered section of the facts file, or the facts numbered N.x. */
function resolvesFact(id: string, facts: ReadonlySet<string>, factSections: ReadonlySet<string>): boolean {
  if (id.includes(".")) return facts.has(id);
  return factSections.has(id) || [...facts].some((f) => f.startsWith(`${id}.`));
}

/** Every `[Mk]` a requirement, a criterion or the registry uses is a milestone the index defines. */
function milestoneTags({ pack, refused }: CheckContext): PackFinding[] {
  const defined = new Set([...pack.milestones.map((m) => m.order), ...[...refused].map((id) => /^M(\d+)$/u.exec(id)?.[1]).filter((n) => n !== undefined).map(Number)]);
  if (defined.size === 0) return [];
  const out: PackFinding[] = [];
  for (const e of [...pack.requirements, ...pack.criteria]) {
    if (e.milestone !== null && !defined.has(e.milestone)) {
      out.push(finding("reference", e, `\`${e.id}\` is tagged [M${String(e.milestone)}], which ## Milestones in ${PRD_INDEX_PATH} does not define`));
    }
  }
  for (const c of pack.codes) {
    const missing = c.milestones.filter((n) => !defined.has(n));
    if (missing.length > 0) {
      out.push(finding("reference", c, `## Codes allows ${c.code} ${missing.map((n) => `[M${String(n)}]`).join(", ")}, which ## Milestones does not define`));
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Section references
 */

export const SECTION_REF = /(?<![\w./-])(?:[\w.-]+\/)*(ADR-\d{3}|[a-z0-9]+(?:-[a-z0-9]+)*)(\.md)?\s+§\s?(\d+(?:\.\d+)*)(?:\s*[–—-]\s*§?\s?(\d+(?:\.\d+)*))?/u;

export const stemOf = (rel: string): string => (rel.split("/").at(-1) ?? rel).replace(/\.md$/u, "");

/**
 * `architecture §3`, `ADR-001 §2`, `01-catalog.md §4`: the document by its
 * name, and the section by its number. A name with `.md` must be a document of
 * the pack; a bare word is a reference only when it is a document's name, so
 * "see §4 of the contract" is prose. `facts §` is the reference rule's.
 */
export function sectionRefs(ctx: CheckContext): PackFinding[] {
  const byStem = new Map<string, string[]>();
  for (const doc of ctx.pack.documents) {
    if (!doc.path.endsWith(".md")) continue;
    const names = [stemOf(doc.path), /^(ADR-\d{3})-/u.exec(stemOf(doc.path))?.[1]].filter((n): n is string => n !== undefined);
    for (const name of names) byStem.set(name, [...(byStem.get(name) ?? []), ...doc.sections]);
  }
  const out: PackFinding[] = [];
  for (const { file, text } of texts(ctx, true)) {
    for (const { m, line } of scan(text, SECTION_REF)) {
      const [ref = "", name = "", md, from = "", to] = m;
      if (name === "facts" || name === "verified-facts") continue;
      const found = byStem.get(name);
      if (found === undefined) {
        if (md !== undefined) out.push(finding("section", { file, line }, `\`${ref.trim()}\`: the pack has no document ${name}.md`));
        continue;
      }
      for (const n of [from, to].filter((s): s is string => s !== undefined && !found.includes(s))) {
        out.push(finding("section", { file, line }, `\`${name}${md ?? ""} §${n}\`: ${name}${md ?? ""} has no section numbered ${n}`));
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Relative links
 */

export const LINK = /\]\(\s*<?([^()<>#\s]+)>?(?:#[^()\s]*)?(?:\s+"[^"]*")?\s*\)/u;
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

/** Inline code spans become spaces of the same length: a link shown in backticks is text, and offsets stay true. */
const withoutCode = (body: string): string => body.replace(/`[^`\n]*`/gu, (span) => " ".repeat(span.length));

/**
 * A relative link reaches a file or directory inside the repository,
 * resolved from the linking document's directory, or from the root when it
 * opens with `/`, as a repository host renders it. A link out of the
 * repository is refused: whether it resolves would depend on the machine.
 */
export function links(ctx: CheckContext): PackFinding[] {
  const out: PackFinding[] = [];
  for (const { file, text } of texts(ctx, false)) {
    const code = { ...text, body: withoutCode(text.body) };
    for (const { m, line } of scan(code, LINK)) {
      const target = m[1] ?? "";
      if (SCHEME.test(target)) continue;
      const resolved = resolve(file, safeDecode(target));
      if (resolved === null) out.push(finding("link", { file, line }, `\`${target}\` points outside the repository`));
      else if (!ctx.exists(resolved)) out.push(finding("link", { file, line }, `\`${target}\` resolves to ${resolved}, which does not exist`));
    }
  }
  return out;
}

export function safeDecode(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** A repo-relative POSIX path, or `null` when `target` climbs out of the repository. */
export function resolve(from: string, target: string): string | null {
  const base = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const parts = [...base];
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg !== "..") parts.push(seg);
    else if (parts.pop() === undefined) return null;
  }
  return parts.length === 0 ? "." : parts.join("/");
}

/* ---------------------------------------------------------------------------
 * Catalogue uses
 */

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

/**
 * How a document uses each kind. Only these phrasings are read; the rest are
 * among what the checker does not check. A setting is read only as a noun,
 * "the setting `x`". In PRDR-280's parity run, "setting `x`" in any sentence
 * took 48 uses in ksarjs: the 34 the noun takes, each in the catalogue, and
 * 14 that name no setting of it, 13 of them the verb ("…, setting `x`"). The
 * other order, "the `x` setting", named a vendor's own setting, or a key
 * inside one, in 2 of its 6 uses.
 */
const USES: Readonly<Record<CatalogueKind, readonly RegExp[]>> = {
  error_codes: [/`?\b[45]\d{2}\b`?\s*(?:with (?:the )?code\s*)?`([a-z][a-z0-9_]*)`/u],
  events: [/\b(?:emits?|emitted|emitting|events?)\s+`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)`/u, /`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)`\s+events?\b/u],
  settings: [/\b(?:[Tt]he|[Aa]|[Mm]arketplace)\s+settings?\s+`([a-z][a-z0-9_.-]*)`/u],
  jobs: [/\bjobs?\s+`([a-z][a-z0-9_-]*)`/u, /`([a-z][a-z0-9_-]*)`\s+jobs?\b/u],
  routes: [new RegExp(`\`((?:${METHODS})(?:/(?:${METHODS}))*)\\s+(/[^\`\\s?]*)`, "u")],
};

const KIND_TITLE: Readonly<Record<CatalogueKind, string>> = {
  error_codes: "Error codes",
  events: "Events",
  settings: "Settings",
  jobs: "Jobs",
  routes: "Routes",
};

/**
 * A route's paths: `{a,b}` is one path per alternative and `[/x]` an optional
 * segment. A parameter, `:id` or `{id}`, matches any parameter in its place,
 * and so does an example value, a segment written in capitals
 * (`/store/products/P`), as criteria name the records of their Given.
 */
export function routePaths(p: string): string[] {
  const optional = /\[(\/[^\]]+)\]/u.exec(p);
  if (optional !== null) {
    const [before, after] = [p.slice(0, optional.index), p.slice(optional.index + optional[0].length)];
    return [...routePaths(before + after), ...routePaths(before + (optional[1] ?? "") + after)];
  }
  const alt = /\{([^{}]*,[^{}]*)\}/u.exec(p);
  if (alt !== null) {
    return (alt[1] ?? "").split(",").flatMap((a) => routePaths(p.slice(0, alt.index) + a.trim() + p.slice(alt.index + alt[0].length)));
  }
  const norm = p.replace(/:[A-Za-z_][A-Za-z0-9_]*|\{[^{}]+\}|(?<=\/)[A-Z][A-Za-z0-9]*(?=\/|$)/gu, ":x").replace(/(?<=.)\/$/u, "");
  return [norm];
}

/** `GET/POST /a/{b,c}` as every `METHOD path` pair it stands for, normalized. */
export function routeKeys(methods: string, p: string): string[] {
  return methods.split("/").flatMap((method) => routePaths(p).map((q) => `${method} ${q}`));
}

/** An elided or placeholder path is an illustration, not a route. */
const illustrative = (p: string): boolean => /…|\.\.\.|<[^>]*>/u.test(p);

/** A path in backticks with no method: `/store/carts/:id`. */
const BARE_PATH = /`(\/[A-Za-z0-9_.-]+\/[^`\s?]*)`/u;

const firstSegment = (p: string): string => `/${p.split("/")[1] ?? ""}`;

const ROUTE_CELL = new RegExp(`^((?:${METHODS})(?:/(?:${METHODS}))*)\\s+(/\\S*)$`, "u");

/** A catalogue's route cell, `GET /a/:id`, as the keys a use is matched against; `null` when it is not a route. */
function routeUse(id: string): string[] | null {
  const m = ROUTE_CELL.exec(id);
  return m === null ? null : routeKeys(m[1] ?? "", m[2] ?? "");
}

const pathOf = (key: string): string => key.slice(key.indexOf(" ") + 1);

/**
 * Every catalogue entry is listed once, and every route is `METHOD /path`. A
 * route is compared by what it matches, so `GET /a/:id` and `GET /a/:order_id`
 * are one route listed twice.
 */
export function catalogueEntries({ pack }: CheckContext): PackFinding[] {
  const notRoutes = pack.catalogues.routes
    .filter((e) => routeUse(e.id) === null)
    .map((e) => finding("catalogue", { file: CATALOGUES_PATH, line: e.line }, `\`${e.id}\`: a route is \`METHOD /path\`, such as \`GET /store/products/:id\``));
  const twiceOver = (Object.keys(pack.catalogues) as CatalogueKind[]).flatMap((kind) =>
    twice(
      pack.catalogues[kind],
      (e) => (kind === "routes" ? (routeUse(e.id) ?? [e.id]).join(" | ") : e.id),
      (e) => ({ file: CATALOGUES_PATH, line: e.line }),
      (e) => e.id,
    ).map((f) => ({ ...f, message: `${f.message} (${KIND_TITLE[kind]})` })),
  );
  return [...notRoutes, ...twiceOver];
}

interface Use {
  readonly line: number;
  /** What the use names, as the catalogue would list it. */
  readonly shown: readonly string[];
  /** The keys it is matched by; one missing from the catalogue makes the use a finding. */
  readonly keys: readonly string[];
}

/** A bare path's key: it matches the path of any route, whatever the method. */
const ANY = "*";

function usesOf(kind: CatalogueKind, text: Text, known: ReadonlySet<string>): Use[] {
  const out: Use[] = [];
  for (const pattern of USES[kind]) {
    for (const { m, line } of scan(text, pattern)) {
      if (kind !== "routes") out.push({ line, shown: [m[1] ?? ""], keys: [m[1] ?? ""] });
      else if (routed(m[2] ?? "", known)) out.push({ line, shown: [`${m[1] ?? ""} ${m[2] ?? ""}`], keys: routeKeys(m[1] ?? "", m[2] ?? "") });
    }
  }
  if (kind !== "routes") return out;
  for (const { m, line } of scan(text, BARE_PATH)) {
    const p = m[1] ?? "";
    if (!routed(p, known) || p.endsWith("/*")) continue;
    const paths = routePaths(p);
    if (paths.every((q) => [...known].some((k) => k.startsWith(`${ANY} ${q}/`)))) continue;
    out.push({ line, shown: [p], keys: paths.map((q) => `${ANY} ${q}`) });
  }
  return out;
}

/**
 * Whether a path is one the route catalogue answers for: under a first
 * segment its routes use, and not an illustration. The seed read only
 * `/store`, `/vendor`, `/admin` and `/hooks`, ksarjs's own; this reads the
 * prefixes the pack's own catalogue uses, so `GET /health` of the framework
 * is not taken for a route the pack forgot.
 */
function routed(p: string, known: ReadonlySet<string>): boolean {
  return !illustrative(p) && known.has(`${ANY} ${firstSegment(p)}/`);
}

/**
 * The keys a kind's catalogue answers to: its ids, or for routes each
 * `METHOD path`, each path under any method, and each first segment, as
 * `* /store/`, so a use under another prefix is not read as a route.
 */
function knownKeys(kind: CatalogueKind, entries: readonly { readonly id: string }[]): Set<string> {
  if (kind !== "routes") return new Set(entries.map((e) => e.id));
  const keys = entries.flatMap((e) => routeUse(e.id) ?? []);
  return new Set([...keys, ...keys.map((k) => `${ANY} ${pathOf(k)}`), ...keys.map((k) => `${ANY} ${firstSegment(pathOf(k))}/`)]);
}

/**
 * Each kind is checked only when `catalogues.md` has its section. A use is
 * one of the phrasings in `USES`, or for routes a bare path, which must be
 * the path of some route or the start of one (`/store/orders` names the
 * namespace of `GET /store/orders/:id`).
 */
export function catalogueUses(ctx: CheckContext): PackFinding[] {
  const catalogue = ctx.lines.get(CATALOGUES_PATH);
  if (catalogue === undefined) return [];
  const present = new Set([...sections(catalogue).keys()].map((k) => CATALOGUE_SECTIONS[k]).filter((k): k is CatalogueKind => k !== undefined));
  const out: PackFinding[] = [];
  for (const kind of present) {
    const known = knownKeys(kind, ctx.pack.catalogues[kind]);
    for (const { file, text } of texts(ctx, true)) {
      if (file === CATALOGUES_PATH) continue;
      const seen = new Set<string>();
      for (const use of usesOf(kind, text, known)) {
        const key = `${String(use.line)} ${use.shown.join(" ")}`;
        if (use.keys.every((k) => known.has(k)) || seen.has(key)) continue;
        seen.add(key);
        out.push(finding("catalogue-use", { file, line: use.line }, `${quoted(use.shown)}: not in ${CATALOGUES_PATH} ## ${KIND_TITLE[kind]}`));
      }
    }
  }
  return out;
}
