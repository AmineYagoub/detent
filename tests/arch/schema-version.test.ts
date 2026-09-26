import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PRDR-300 — nothing names a schema version but `SCHEMA_VERSION` (F-3″).
 *
 * Before the first F-3 event, 31 places in `src/`, the prompt manifest's
 * writer and three prompts said 1 outright. A version bump then leaves each of
 * them stamping, or asking a session for, a version the schemas refuse. Only
 * the constant may say the number.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, ext));
    else if (name.endsWith(ext)) out.push(abs);
  }
  return out;
}

const LITERAL = /schema_version["'`]?\s*:\s*\d/u;

describe("PRDR-300: only the constant names a schema version", () => {
  it("finds no literal version in a source file, a script or a prompt", () => {
    const files = [
      ...walk(path.join(ROOT, "src"), ".ts"),
      ...walk(path.join(ROOT, "scripts"), ".ts"),
      ...walk(path.join(ROOT, "prompts"), ".md"),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "src/schemas/common.ts") continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (LITERAL.test(line)) hits.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
