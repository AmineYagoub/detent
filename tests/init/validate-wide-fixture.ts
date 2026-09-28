import path from "node:path";
import type { Json } from "./decide-fixture.js";
import { WROTE, packFor, write, type Write } from "./write-fixture.js";

/**
 * A pack of seven areas for VALIDATE's tests at scale (PRDR-313, PRDR-314):
 * WRITE's fixture pack with Lending in an area of its own name, and five more
 * module PRDs cloned from it under their own codes and areas.
 */

export const CODES = ["LND", "BRW", "RTN", "FEE", "MBR", "INV"];
/** Lending keeps its name, which the writer fixture edits. */
export const prdOf = (i: number): string => (i === 0 ? "docs/prd/01-lending.md" : `docs/prd/0${String(i + 1)}-${(CODES[i] ?? "").toLowerCase()}.md`);
/** Every area, in the order a round reviews them. */
export const ALL = ["foundations", ...CODES.map((c) => `Area ${c}`)];

function widePack(inputs: Json): Record<string, string> {
  const base = packFor(inputs);
  const lending = base["docs/prd/01-lending.md"] ?? "";
  const rows = CODES.map((code, i) => `| ${code} | Area ${code} | [${path.posix.basename(prdOf(i))}](${path.posix.basename(prdOf(i))}) | M1 |`);
  const index = (base["docs/prd/index.md"] ?? "").replace("| LND | Lending | [01-lending.md](01-lending.md) | M1 |", rows.join("\n"));
  const modules = Object.fromEntries(CODES.map((code, i) => [prdOf(i), lending.replaceAll("LND", code).replace("# 01 — Lending", `# 0${String(i + 1)} — ${code}`)]));
  return { ...base, "docs/prd/index.md": index, ...modules };
}

/** WRITE, writing the seven-area pack. */
export const wide = (): Write => write((_, inputs) => ({ files: widePack(inputs), artifact: WROTE() }));

/** WRITE, writing the seven-area pack with each module PRD passed through `spoil`; `green` holds each as it was before. */
export function wideSpoiled(spoil: (text: string, code: string) => string): { readonly stub: Write; readonly green: Map<string, string> } {
  const green = new Map<string, string>();
  const stub = write((_, inputs) => {
    const files = widePack(inputs);
    for (const [i, code] of CODES.entries()) {
      const text = files[prdOf(i)] ?? "";
      green.set(prdOf(i), text);
      files[prdOf(i)] = spoil(text, code);
    }
    return { files, artifact: WROTE() };
  });
  return { stub, green };
}
