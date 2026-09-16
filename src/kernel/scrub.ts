/**
 * T-052 — secret scrubbing (SEC-4): ledger, logs and failure records are
 * scrubbed by pattern BEFORE write. Scrubbing after the fact is not a
 * control — once a secret is on disk it has leaked.
 */

interface ScrubRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const RULES: readonly ScrubRule[] = [
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{8,}/g },
  /**
   * PRDR-177: `\b`, because without it this matched INSIDE words. A
   * content-hashed build artifact — `dist/assets/task-BX9kL2mQz8vN4pR7tY1wS3dF`
   * — contains `sk-` at "ta|sk-", and came out as `ta[REDACTED].js`. So did
   * `infra/risk-0123456789abcdef01234567.tf`. A real key never begins mid-word.
   */
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{20,}/g },
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "bearer", pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  {
    name: "assignment",
    /**
     * KEY=..., token: "...", password = '...' — the generic shapes.
     *
     * PRDR-177 fixed two ways this ate ordinary prose. The plural `s` sat
     * OUTSIDE the capture group, so `tokens: 128374 in` was rewritten
     * `token: [REDACTED] in` — redacted AND silently singularised. And the
     * value was any 6+ non-space run, so `Unexpected token: identifier` and a
     * human's own `the token: refresh path` were redacted as credentials.
     *
     * The value must now look like one: quoted, or containing a digit, or 16+
     * characters. That is a deliberate loosening and the trade is stated —
     * an unquoted all-letter secret of 6 to 15 characters is no longer caught
     * by THIS rule. The shaped rules above still catch every known key format,
     * and a redactor that mangles compiler errors and operator guidance is one
     * whose output nobody can trust as evidence.
     *
     * Known and deliberately NOT loosened further: a purely numeric value still
     * redacts, so telemetry prose reads `tokens: [REDACTED] in, 4211 out`. A
     * third exemption would be a third security judgement, and this one is
     * cosmetic and fails in the safe direction — the surviving second number
     * makes the redaction visibly odd rather than misleading.
     */
    pattern:
      /\b((?:api[_-]?key|access[_-]?key|secret|token|password|passwd|credential)s?)\b(["']?\s*[:=]\s*)(["']?)((?=[^\s"'&]*\d)[^\s"'&]{6,}|[^\s"'&]{16,})\3/gi,
  },
];

export const REDACTED = "[REDACTED]";

export function scrub(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match, ...groups) => {
      /**
       * The assignment rule keeps the key name and the separator, so a
       * scrubbed record still says WHAT was redacted.
       */
      if (rule.name === "assignment") {
        const [keyName, sep, quote] = groups as [string, string, string];
        return `${keyName}${sep}${quote}${REDACTED}${quote}`;
      }
      void match;
      return REDACTED;
    });
  }
  return out;
}

/** True when scrubbing changed anything — callers may want to log that it did. */
export function containsSecrets(text: string): boolean {
  return scrub(text) !== text;
}

/**
 * SEC-4 (PRDR-252): scrub every string in a JSON-serializable value.
 *
 * Returns `unknown` on purpose. The caller re-validates through its own schema,
 * which both keeps the type honest and proves the redaction left a valid
 * artifact — `[REDACTED]` is a valid string everywhere Detent's schemas take
 * one, and a caller that cannot show that should not be scrubbing this way.
 *
 * It exists because `fs/layout.ts` cannot hold this. ARCH-1/N-1 keeps kernel
 * policy out of `fs/` and `adapter/` — the reason `adapter/bind.ts` takes
 * `redact` as a required parameter rather than importing this module — so
 * `writeArtifact` is a primitive and the composing layer redacts.
 */
export function scrubJson(value: unknown): unknown {
  return JSON.parse(scrub(JSON.stringify(value)));
}
