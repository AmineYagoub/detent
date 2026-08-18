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
  { name: "openai-key", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "bearer", pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  {
    name: "assignment",
    /* KEY=..., token: "...", password = '...' — the generic shapes. */
    pattern: /\b(api[_-]?key|access[_-]?key|secret|token|password|passwd|credential)s?\b(["']?\s*[:=]\s*)(["']?)[^\s"'&]{6,}\3/gi,
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
