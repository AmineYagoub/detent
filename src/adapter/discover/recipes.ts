/**
 * Recipe-file parsing shared by the Makefile and justfile engines (T-025).
 *
 * Both formats declare `name:` at column zero and indent the body. The parser
 * captures each target's whole block, because that block — and nothing else in
 * the file — is what defines the command's behaviour (V-3 region precision).
 */

export interface Recipe {
  readonly name: string;
  /** The declaration line plus its indented body, verbatim. */
  readonly block: string;
}

const TARGET = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)([^=].*)?$/;

export function parseRecipes(text: string): Recipe[] {
  const lines = text.split("\n");
  const recipes: Recipe[] = [];
  let current: { name: string; block: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) recipes.push({ name: current.name, block: current.block.join("\n") });
    current = null;
  };

  for (const line of lines) {
    const match = TARGET.exec(line);
    /** A target declaration starts at column zero; anything indented is a body. */
    if (match !== null && !/^\s/.test(line)) {
      flush();
      const name = match[1] as string;
      /* `.PHONY` and friends declare metadata, not work. */
      current = name.startsWith(".") ? null : { name, block: [line] };
      continue;
    }
    if (current !== null) {
      if (line.trim() === "" || /^\s/.test(line)) current.block.push(line);
      else flush();
    }
  }
  flush();
  return recipes.map((r) => ({ name: r.name, block: r.block.replace(/\s+$/, "") }));
}
