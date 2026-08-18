/**
 * T-052 — the allowlisted session environment (SEC-4).
 *
 * Sessions inherit ONLY what this module passes: the allowlist is a policy
 * surface, not just a secret filter. A variable Detent itself sets and needs
 * is listed explicitly, never left to inheritance — including the
 * prompt-cache lifetime mechanism of S-6, which would otherwise be silently
 * stripped and leave S-6's purpose unmet with nothing to indicate why.
 */

/** Baseline process needs. */
const RUNTIME_VARS = ["PATH", "HOME", "SHELL", "TMPDIR", "TERM", "LANG", "LC_ALL", "USER"] as const;

/** The backend's own credentials and knobs Detent sanctions. */
const BACKEND_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  // S-6 (PRDR-054): the extended prompt-cache lifetime rides the documented
  // custom-headers mechanism; the behavioural check — non-zero cache reads
  // across a >5-minute gate gap — is T-046's live AC.
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

export const SESSION_ENV_ALLOWLIST: readonly string[] = [...RUNTIME_VARS, ...BACKEND_VARS];

/** S-6: the value Detent sets on the TTL carrier when nothing else did. */
export const EXTENDED_CACHE_HEADER = "anthropic-beta: extended-cache-ttl-2025-04-11";

/**
 * Build a session's environment: allowlisted inheritance plus Detent's own
 * additions. Everything else — cloud credentials, tokens, deploy keys — never
 * crosses into a session.
 */
export function buildSessionEnv(
  parent: NodeJS.ProcessEnv = process.env,
  detentSet: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SESSION_ENV_ALLOWLIST) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  // S-6: request the extended cache lifetime unless the operator already did.
  if (env["ANTHROPIC_CUSTOM_HEADERS"] === undefined) {
    env["ANTHROPIC_CUSTOM_HEADERS"] = EXTENDED_CACHE_HEADER;
  }
  for (const [key, value] of Object.entries(detentSet)) env[key] = value;
  return env;
}
