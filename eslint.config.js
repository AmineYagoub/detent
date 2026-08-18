// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ARCH-1 dependency-direction lint (T-003, R-5).
 *
 * The layer boundary is a normative requirement, not a stylistic preference
 * (D-19). These zones are the mechanical half; T-054 supplies the audit half.
 *
 * `src/kernel/**` may not import the session backend's SDK types, nor reach
 * into `src/sessions/**` beyond the `backend.ts` interface. `src/sessions/**`
 * may not import kernel state mutators — which is only expressible to
 * `no-restricted-imports` because T-017 lands `tickets/` as a directory with
 * `mutations.ts` separated from `readers.ts`.
 */
const KERNEL_FORBIDDEN = [
  {
    group: ["@anthropic-ai/*"],
    message:
      "ARCH-1: src/kernel/** must not import the session backend SDK. Session output enters the kernel only through the §10 schema validators.",
  },
  {
    group: ["**/sessions/**", "!**/sessions/backend.js", "!**/sessions/backend"],
    message:
      "ARCH-1: src/kernel/** may import only the SessionBackend interface from src/sessions/backend.ts.",
  },
];

/**
 * PRDR-059 / draft.7: the layers below the kernel are zoned too. The zone list
 * is §3a's diagram read as edges — sessions and the verification adapter (and
 * the fs/cli layers beside it) import no kernel state mutators and no
 * transition table; `schemas/**` is below every layer and importable anywhere.
 */
const BELOW_KERNEL_FORBIDDEN = [
  {
    group: ["**/kernel/machine", "**/kernel/machine.js"],
    message:
      "ARCH-1: layers below the kernel do not apply events or read the transition table. Only the kernel applies events (P2).",
  },
  {
    group: ["**/kernel/tickets/mutations", "**/kernel/tickets/mutations.js"],
    message: "ARCH-1: only the kernel writes ticket state. Read via tickets/readers.ts.",
  },
];

const SESSIONS_FORBIDDEN = [
  {
    group: ["**/kernel/machine", "**/kernel/machine.js"],
    message:
      "ARCH-1: src/sessions/** must not apply events. Only the kernel applies events (P2).",
  },
  {
    group: ["**/kernel/tickets/mutations", "**/kernel/tickets/mutations.js"],
    message:
      "ARCH-1: src/sessions/** must not import kernel state mutators. Read via tickets/readers.ts.",
  },
];

/**
 * AGENTS.md: `//` never appears in a .ts file — documentation lives in
 * `/** *\/` blocks on declarations; rare standalone block comments may state a
 * why inside a body (an empty catch). Compiler/lint directives are the one
 * escape: TypeScript only honors `@ts-expect-error` in line form.
 */
const detentPlugin = {
  rules: {
    "no-line-comments": {
      meta: {
        type: "layout",
        messages: { line: "AGENTS.md: no `//` comments — use a /** */ doc-block on the declaration (or a standalone /* */ for an in-body why)." },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.type !== "Line") continue;
              if (/^\s*(@ts-|eslint-)/.test(comment.value)) continue;
              context.report({ loc: comment.loc, messageId: "line" });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tests/arch/fixtures/**",
      // T-030's fixture repositories are other projects' code, not Detent's.
      "tests/fixtures/ts-service/**",
      "tests/fixtures/py-service/**",
      "tests/fixtures/go-cli/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // AGENTS.md's lint-enforced half: file-size ceilings, no inline comments,
    // and the modern-syntax floor. Scoped to our TS so config files stay out.
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
    plugins: { detent: detentPlugin },
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "no-inline-comments": "error",
      "detent/no-line-comments": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-template": "error",
      "prefer-arrow-callback": "error",
      "object-shorthand": "error",
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "AGENTS.md: no enums — use a union of string literals." },
        { selector: "ExportDefaultDeclaration", message: "AGENTS.md: named exports only." },
      ],
    },
  },
  {
    // Test and script files: same rules, roomier ceiling (AGENTS.md).
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // MP0 (v3): `src/referee/**` — the tool boundary — sits with the kernel on
    // the sealed side of ARCH-1: same rules, same seam. The MCP transport SDK
    // is infrastructure, not the session backend, and stays permitted.
    files: ["src/kernel/**/*.ts", "src/referee/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: KERNEL_FORBIDDEN }],
    },
  },
  {
    files: ["src/sessions/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SESSIONS_FORBIDDEN }],
    },
  },
  {
    files: ["src/adapter/**/*.ts", "src/fs/**/*.ts", "src/cli/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: BELOW_KERNEL_FORBIDDEN }],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
