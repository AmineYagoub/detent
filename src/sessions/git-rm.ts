/**
 * S-3⁵ (PRDR-213) — the third verb, read before it is judged.
 *
 * A write session's Bash was `git add` and `git commit`. Nothing it had removed
 * a file, so a scope finding that named one was unfixable: gate-313's bootstrap
 * spent its whole review-fix ladder on a staged probe file, and the third
 * attempt committed it by accident. `git rm` joins the two verbs, and the
 * containment guard judges it per pathspec the way it judges a Write. This
 * module is the reading — which paths a command names, or why it cannot be
 * read. The guard denies what cannot be read: S-2‴ abstains on a call that
 * names no path, and this one names paths.
 *
 * Deliberately narrow. The SDK splits a compound command and refuses any part
 * outside the allowlist, so shell is not this module's to parse — one simple
 * command, plain tokens, known options, or a refusal that says why.
 */

export type GitRmReading =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly detail: string };

/** The options a session may pass; anything else is unread and refused. */
const KNOWN_OPTIONS: ReadonlySet<string> = new Set(["-f", "--force", "-q", "--quiet", "--cached"]);

/** A token the guard reads: path characters only — no quotes, no shell, no glob, no pathspec magic. */
const PLAIN_TOKEN = /^[A-Za-z0-9._/@+,=-]+$/;

/**
 * `git rm` as a command — at the start, or after a separator that starts one.
 * A mention inside a quoted argument is somebody's commit message, not a
 * deletion, and stays the allowlist's call.
 */
const GIT_RM_COMMAND = /(^|[;&|(`\n]\s*)git\s+rm(\s|$)/;

export function commandOf(toolInput: unknown): string {
  if (typeof toolInput !== "object" || toolInput === null) return "";
  const command = (toolInput as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : "";
}

/** The paths a `git rm` names, why it cannot be read, or `null` for a command that is not one. */
export function readGitRm(command: string): GitRmReading | null {
  if (!GIT_RM_COMMAND.test(command)) return null;
  const tokens = command.trim().split(/[ \t]+/);
  if (tokens[0] !== "git" || tokens[1] !== "rm") {
    return { ok: false, detail: "`git rm` must be the whole command, not one part of a compound one" };
  }
  const paths: string[] = [];
  let optionsDone = false;
  for (const token of tokens.slice(2)) {
    if (!PLAIN_TOKEN.test(token)) return { ok: false, detail: `\`${token}\` is not a plain path or a known option` };
    if (!optionsDone && token === "--") {
      optionsDone = true;
      continue;
    }
    if (!optionsDone && token.startsWith("-")) {
      if (!KNOWN_OPTIONS.has(token)) return { ok: false, detail: `option \`${token}\` is not read` };
      continue;
    }
    paths.push(token);
  }
  if (paths.length === 0) return { ok: false, detail: "no pathspec" };
  return { ok: true, paths };
}
