/**
 * Just enough TOML to answer "is this table declared, and what does it say?".
 *
 * N-3 pins the runtime dependency set to three packages, so a TOML parser is
 * not available and is not warranted: discovery needs table *presence* and the
 * table's verbatim text for the V-3 region, never a typed value.
 */

export interface TomlTable {
  readonly name: string;
  /** The header line plus everything up to the next header, verbatim. */
  readonly block: string;
}

const HEADER = /^\s*\[\[?([^\]]+)\]\]?\s*$/;

export function parseTables(text: string): TomlTable[] {
  const tables: TomlTable[] = [];
  let current: { name: string; lines: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) tables.push({ name: current.name, block: current.lines.join("\n").replace(/\s+$/, "") });
    current = null;
  };

  for (const line of text.split("\n")) {
    const header = HEADER.exec(line);
    if (header !== null) {
      flush();
      current = { name: (header[1] as string).trim(), lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return tables;
}

export function findTable(tables: readonly TomlTable[], name: string): TomlTable | undefined {
  return tables.find((t) => t.name === name);
}
