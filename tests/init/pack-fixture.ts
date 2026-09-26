import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { git, gitInit, removeTree, tmpTree } from "../helpers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * PRDR-279 — a small pack in C-2⁷'s schema, shared by the pack tests.
 *
 * Every table kind and both bullet kinds appear at least once, and so does
 * every optional part: a facts file, a design document, an ADR, a catalogue,
 * a stack entry and a second package. The project has no stack markers, so it
 * is greenfield and its stack entry is required, not decorative.
 */

export const DECISION_LOG = [
  "# Founder decisions",
  "",
  "## Decisions",
  "",
  "| Id | Question | Answer | Reason |",
  "|---|---|---|---|",
  "| D-1 | Which currencies does checkout accept? | DZD only in V1 | The launch market is Algeria. |",
  "",
  "## Defaults",
  "",
  "| Id | Default | Reason |",
  "|---|---|---|",
  "| X-1 | Prices are stored in minor units. | Integer arithmetic has no rounding drift. |",
  "| X-2 | The stack is TypeScript on Node.js 22 with pnpm. | The documents name no stack; this is their tooling. |",
  "",
  "## Stack",
  "",
  "| Field | Value |",
  "|---|---|",
  "| decision | X-2 |",
  "| language | TypeScript |",
  "| toolchain | Node.js 22 with pnpm 9 |",
  "| scaffold | `package.json`, `tsconfig.json` |",
  "",
  "## Packages",
  "",
  "| Package | Slot | Command |",
  "|---|---|---|",
  "| . | test | `pnpm test` |",
  "| . | lint | `pnpm lint` |",
  "| dashboard | test | `pnpm --dir dashboard test` |",
  "",
].join("\n");

export const CATALOG_PRD = [
  "# Catalog",
  "",
  "## Requirements",
  "",
  "- **CAT-F-001** [M0] The catalog MUST store every product with a title and a price in minor units (X-1).",
  "- **CAT-F-002** [M1] A product listing SHOULD show its price in DZD (D-1).",
  "- **CAT-N-001** [M1] Listing 1,000 products MUST answer within 300 ms.",
  "- **CAT-F-003** [withdrawn] Products carried a legacy flag.",
  "",
  "## Acceptance criteria",
  "",
  "- **CAT-AC-01** [M0] Given a product titled `Mug` priced 1500, when it is stored and read back, then the title",
  "  is `Mug` and the price is 1500 (CAT-F-001).",
  "- **CAT-AC-02** [M1] Given 1,000 products, when the listing is requested, then it answers within 300 ms and",
  "  shows `DZD` prices (CAT-F-002, CAT-N-001).",
  "",
].join("\n");

export const CONFORMING_PACK: Readonly<Record<string, string>> = {
  "README.md": "# Shop\n\nA small shop. The specification is under `docs/`.\n",
  "docs/founder-decisions.md": DECISION_LOG,
  "docs/research/verified-facts.md": [
    "# Verified facts",
    "",
    "| Id | Fact | Source | Tag |",
    "|---|---|---|---|",
    "| 1.1 | Chargily settles card payments in DZD. | https://dev.chargily.com/pay-v2/introduction | doc |",
    "| 1.2 | Chargily retries a failed webhook three times. | https://dev.chargily.com/pay-v2/webhooks | unverified |",
    "",
  ].join("\n"),
  "docs/design/architecture.md": [
    "# Architecture",
    "",
    "## 1. Modules",
    "",
    "Checkout depends on the catalog (X-1).",
    "",
    "### 1.1 Money",
    "",
    "Amounts are integers (facts §1.1).",
    "",
  ].join("\n"),
  "docs/design/catalogues.md": [
    "# Catalogues",
    "",
    "## Error codes",
    "",
    "| Code | Status | Meaning |",
    "|---|---|---|",
    "| `cart_empty` | 409 | The cart has no lines. |",
    "",
    "## Events",
    "",
    "| Event | Payload |",
    "|---|---|",
    "| `order.placed` | the order id |",
    "",
    "## Routes",
    "",
    "| Route | Purpose |",
    "|---|---|",
    "| `POST /store/checkout` | Places the order. |",
    "",
  ].join("\n"),
  "docs/adr/ADR-001-integer-money.md": "# ADR-001: integer money\n\n## 1. Decision\n\nMoney is a count of minor units (X-1).\n",
  "docs/prd/index.md": [
    "# Product requirements",
    "",
    "## Codes",
    "",
    "| Code | Area | PRD | Milestones |",
    "|---|---|---|---|",
    "| CAT | Catalog | [01-catalog.md](01-catalog.md) | M0, M1 |",
    "| CHK | Checkout | [02-checkout.md](02-checkout.md) | M1 |",
    "",
    "## Milestones",
    "",
    "| Milestone | Contents |",
    "|---|---|",
    "| M0 | Foundations |",
    "| M1 | Selling |",
    "",
  ].join("\n"),
  "docs/prd/01-catalog.md": CATALOG_PRD,
  "docs/prd/02-checkout.md": [
    "# Checkout",
    "",
    "- **CHK-F-001** [M1] Checkout MUST refuse an empty cart with `409` `cart_empty`, and MUST emit `order.placed`",
    "  once the order is stored (CAT-F-001).",
    "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only (D-1).",
    "",
    "- **CHK-AC-01** [M1] Given an empty cart, when `POST /store/checkout` is called, then it answers `409`",
    "  `cart_empty` (CHK-F-001).",
    "- **CHK-AC-02** [M1] Given a cart holding one product at 1500 DZD, when it is checked out, then one",
    "  `order.placed` event carries the order id, and a EUR cart answers `409` (CHK-F-001–CHK-F-002).",
    "",
  ].join("\n"),
};

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A committed git repository holding `files`, removed after the test. */
export function packRepo(files: Readonly<Record<string, string>> = CONFORMING_PACK): string {
  const root = tmpTree(files);
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "pack");
  return root;
}

/** Two validation rounds: the first left a major, the second only a minor it did not fix. */
export const ORACLE_ROUNDS = [
  { round: 1, counts: { blocker: 0, major: 1, minor: 2 }, open: [] },
  {
    round: 2,
    counts: { blocker: 0, major: 0, minor: 1 },
    open: [{ severity: "minor", file: "docs/prd/01-catalog.md", line: 8, quote: "a legacy flag", fix: "Drop the withdrawn requirement's text." }],
  },
] as const;

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The record C-2⁷ describes, computed here without the code under test: every
 * document discovery finds, each with the sha256 of its bytes, and one hash
 * over the sorted `path NUL sha256 LF` lines. A test that built its record with
 * the function it tests could not tell a wrong hash from a right one.
 */
export function oracleRecord(
  root: string,
  overrides: { readonly green?: boolean; readonly date?: string } = {},
): Record<string, unknown> {
  const documents: Record<string, string> = {};
  for (const doc of discoverDocs(root).docs) documents[doc] = sha256(readFileSync(path.join(root, doc)));
  const lines = Object.keys(documents)
    .sort()
    .map((doc) => `${doc}\0${documents[doc] ?? ""}\n`)
    .join("");
  return {
    schema_version: SCHEMA_VERSION,
    hash: sha256(lines),
    documents,
    checker: { green: overrides.green ?? true, findings: [] },
    rounds: ORACLE_ROUNDS,
    date: overrides.date ?? "2026-09-26",
    /* PRDR-283: VALIDATE finished; a pack WRITE wrote and nothing validated says false. */
    validated: true,
  };
}

/** Commit the oracle's record where C-2⁷ puts it: `docs/conformance.json`. */
export function commitRecord(root: string, record: Record<string, unknown> = oracleRecord(root)): void {
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "conformance.json"), `${JSON.stringify(record, null, 2)}\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "record");
}
