import { supersededRoutes, unservedRoutes, type SupersededRoute, type UnservedRoute } from "../schemas/roles.js";

/**
 * S-5⁶ (PRDR-319) — what a routing's problems read as, in one module, so that
 * `doctor`, `init` and `run` say them alike (ARCH-2).
 *
 * Two problems, neither a refusal. A role routed to a model the bundled runtime
 * does not serve runs on the runtime's default instead (PRDR-114), which is a
 * different model than the config names; `doctor` fails on it, and `init` and
 * `run` say it before their first session. A role routed to a default S-5⁶
 * superseded is the config's own choice as far as anything can tell (S-5′), so
 * it is named with the line that moves it, and the config is never rewritten.
 */

/**
 * The 1-based line of `role`'s entry in `model_routing`, read from the config
 * file's own text, or null when the text holds no such entry. The first line
 * naming the role at or after the line that opens `model_routing`, since
 * `effort_routing` names the same roles.
 */
export function routingLine(configText: string, role: string): number | null {
  const lines = configText.split("\n");
  const opens = lines.findIndex((l) => /"model_routing"\s*:/u.test(l));
  if (opens === -1) return null;
  const key = new RegExp(`"${role.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"\\s*:`, "u");
  for (let i = opens; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const from = i === opens ? line.indexOf('"model_routing"') : 0;
    if (key.test(line.slice(from))) return i + 1;
  }
  return null;
}

/** `implement → claude-sonnet-5-5 (first served by 2.1.284)`, joined. */
export function unservedList(unserved: readonly UnservedRoute[]): string {
  return unserved.map((u) => `${u.role} → ${u.model} (first served by ${u.first})`).join("; ");
}

/** `.detent/config.json:14 "review": "claude-opus-5-5" (now claude-opus-5)`, joined. */
export function supersededMoves(superseded: readonly SupersededRoute[], configText: string | null): string {
  return superseded
    .map((s) => {
      const line = configText === null ? null : routingLine(configText, s.role);
      return `.detent/config.json${line === null ? "" : `:${String(line)}`} "${s.role}": "${s.successor}" (now ${s.model})`;
    })
    .join("; ");
}

export function unservedSentence(runtime: string, unserved: readonly UnservedRoute[]): string {
  return (
    `the runtime this Detent bundles, Claude Code ${runtime}, does not serve ${unservedList(unserved)}. ` +
    "Those sessions would run on the runtime's default model instead (S-5′): route each role to a model it serves, " +
    "or use a Detent whose SDK bundles a newer runtime (S-5⁶)"
  );
}

export function supersededSentence(superseded: readonly SupersededRoute[], configText: string | null): string {
  const n = superseded.length;
  return (
    `${String(n)} role${n === 1 ? " is" : "s are"} routed to a model a newer default supersedes, and this config keeps ` +
    `its own routing (S-5′). To move ${n === 1 ? "it" : "each"}, set in model_routing: ${supersededMoves(superseded, configText)} (S-5⁶)`
  );
}

/**
 * The lines `init` and `run` say before their first session: none when every
 * routed model is served and none is superseded. `runtime` null, or not a
 * version, judges no model against it; the superseded defaults are named all
 * the same, since they need no runtime to judge.
 */
export function routingAdvice(routing: Readonly<Record<string, string>>, runtime: string | null, configText: string | null): string[] {
  const out: string[] = [];
  const unserved = runtime === null ? null : unservedRoutes(routing, runtime);
  if (runtime !== null && unserved === null) {
    out.push(`model routing: the bundled runtime's version could not be read (${runtime}), so no routed model was judged against it (S-5⁶)`);
  }
  if (runtime !== null && unserved !== null && unserved.length > 0) out.push(`model routing: ${unservedSentence(runtime, unserved)}`);
  const superseded = supersededRoutes(routing);
  if (superseded.length > 0) out.push(`model routing: ${supersededSentence(superseded, configText)}`);
  return out;
}
