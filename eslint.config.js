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
    files: ["src/kernel/**/*.ts"],
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
