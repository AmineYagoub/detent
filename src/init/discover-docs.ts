import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

/**
 * T-061 — planning-document discovery (C-2's docs half).
 *
 * Deterministic and token-free, like the stack-facts half (T-025): the same
 * tree yields the same list, sorted, in POSIX form. When nothing is found the
 * caller raises AWAIT_DOCS carrying **exactly what was looked for** — a user
 * told "no docs found" without the patterns cannot tell whether their file is
 * misnamed or their directory is wrong.
 */

/** C-2's named heuristics. Extending this list changes what `init` accepts. */
export const DOC_PATTERNS: readonly string[] = [
  "PRD*.md",
  "PRD*.txt",
  "SRS*.md",
  "SRS*.txt",
  "README*.md",
  "REQUIREMENTS*.md",
  "SPEC*.md",
  "docs/**/*.md",
  "docs/**/*.txt",
  "docs/**/*.rst",
];

/** Never traversed: dependency and state trees are not planning documents. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".detent", "dist", "build", "vendor", "target", ".venv", "__pycache__"]);

export interface DocDiscovery {
  /** Repo-relative POSIX paths, sorted — byte-identical across runs (C-2/N-2). */
  readonly docs: readonly string[];
  /** What was searched, for AWAIT_DOCS's message. */
  readonly patternsSearched: readonly string[];
}

export function discoverDocs(root: string, patterns: readonly string[] = DOC_PATTERNS): DocDiscovery {
  const isMatch = picomatch([...patterns], { dot: false });
  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      let stats;
      try {
        stats = statSync(abs);
      } catch {
        /* a broken symlink is not a document */
        continue;
      }
      if (stats.isDirectory()) walk(abs, rel);
      else if (isMatch(rel)) found.push(rel);
    }
  };

  if (existsSync(root)) walk(root, "");
  return { docs: found.sort(), patternsSearched: [...patterns] };
}

/** The AWAIT_DOCS message: what was looked for, verbatim (C-2's AC). */
export function awaitDocsMessage(discovery: DocDiscovery, root: string): string {
  return [
    `No planning documents found in ${root}.`,
    "Detent looked for:",
    ...discovery.patternsSearched.map((p) => `  ${p}`),
    "Add a planning document matching one of these and re-run `detent init`.",
  ].join("\n");
}
