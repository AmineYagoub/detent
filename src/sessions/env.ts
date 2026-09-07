/**
 * T-052 — the allowlisted session environment (SEC-4).
 *
 * Sessions inherit ONLY what this module passes: the allowlist is a policy
 * surface, not just a secret filter. A variable Detent itself sets and needs
 * is listed explicitly, never left to inheritance — including the
 * prompt-cache lifetime mechanism of S-6, which would otherwise be silently
 * stripped and leave S-6's purpose unmet with nothing to indicate why.
 */

/**
 * Baseline process needs. `LOGNAME` accompanies `USER`: the CLI's own auth
 * probe reads both, and a supervisor script written for this project reported
 * `loggedIn: false` until both were exported (PRDR-148).
 */
const RUNTIME_VARS = ["PATH", "HOME", "SHELL", "TMPDIR", "TERM", "LANG", "LC_ALL", "USER", "LOGNAME"] as const;

/**
 * PRDR-148: reaching the network at all. An operator behind a corporate proxy
 * or a TLS-intercepting gateway needs these, and a session that cannot reach
 * the API is not more secure than one that can — it is broken, and the
 * operator chose that proxy. A proxy URL can embed credentials, so this is a
 * real trade, made deliberately and written down rather than decided by
 * omission.
 */
const NETWORK_VARS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

/** The backend's own credentials and knobs Detent sanctions. */
const BACKEND_VARS = [
  "ANTHROPIC_API_KEY",
  /**
   * PRDR-148: `hasLiveBackendAuth` names THREE transports and this list carried
   * one. While `buildSessionEnv` had no caller the gap was inert — sessions
   * inherited the token and worked. Wiring the allowlist (PRDR-133) turned a
   * harmless staleness into an outage on the documented subscription-CI path.
   * A control that has never run has never been checked.
   */
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  /*
   * S-6 (PRDR-054): the extended prompt-cache lifetime rides the documented
   * custom-headers mechanism; the behavioural check — non-zero cache reads
   * across a >5-minute gate gap — is T-046's live AC.
   */
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

export const SESSION_ENV_ALLOWLIST: readonly string[] = [...RUNTIME_VARS, ...NETWORK_VARS, ...BACKEND_VARS];

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
  /** S-6: request the extended cache lifetime unless the operator already did. */
  if (env["ANTHROPIC_CUSTOM_HEADERS"] === undefined) {
    env["ANTHROPIC_CUSTOM_HEADERS"] = EXTENDED_CACHE_HEADER;
  }
  for (const [key, value] of Object.entries(detentSet)) env[key] = value;
  return env;
}
