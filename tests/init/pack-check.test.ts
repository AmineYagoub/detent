import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { UNCHECKED, checkPack, renderPackCheck, type PackCheck } from "../../src/init/pack-check.js";
import { CONFORMING_PACK, packRepo } from "./pack-fixture.js";

/**
 * PRDR-280 — the pack checker (C-2⁷): each rule fails a fixture built to
 * break it and passes the conforming pack; the one heuristic reports and never
 * blocks; the output is byte-identical for the same pack and says what it does
 * not check.
 */

type Files = Readonly<Record<string, string>>;

function check(files: Files, greenfield = true): PackCheck {
  const root = packRepo(files);
  return checkPack(root, discoverDocs(root).docs, { greenfield });
}

const withFile = (file: string, text: string): Files => ({ ...CONFORMING_PACK, [file]: text });
const append = (file: string, extra: string): Files => withFile(file, `${CONFORMING_PACK[file] ?? ""}${extra}\n`);
const swap = (file: string, from: string, to: string): Files => {
  const text = CONFORMING_PACK[file] ?? "";
  if (!text.includes(from)) throw new Error(`fixture: ${file} has no ${from}`);
  return withFile(file, text.replace(from, to));
};
const of = (c: PackCheck, rule: string) => c.findings.filter((f) => f.rule === rule);
const said = (c: PackCheck, rule: string) => of(c, rule).map((f) => f.message).join("\n");

const CATALOG = "docs/prd/01-catalog.md";
const CHECKOUT = "docs/prd/02-checkout.md";
const INDEX = "docs/prd/index.md";
const LOG = "docs/founder-decisions.md";
const FACTS = "docs/research/verified-facts.md";
const ARCH = "docs/design/architecture.md";
const CATALOGUES = "docs/design/catalogues.md";

describe("PRDR-280: the conforming pack passes every rule", () => {
  it("is green with no finding at all", () => {
    expect(check(CONFORMING_PACK)).toEqual({ green: true, findings: [] });
  });
});

describe("PRDR-280: every id is defined exactly once", () => {
  const cases: readonly (readonly [string, Files, string])[] = [
    ["a requirement", append(CATALOG, "- **CAT-F-001** [M1] The catalog MUST store a second thing."), "CAT-F-001"],
    ["a criterion", append(CATALOG, "- **CAT-AC-01** [M1] Given a mug, when it is read, then it is shown (CAT-F-001)."), "CAT-AC-01"],
    ["a decision", swap(LOG, "| D-1 | Which", "| D-1 | Is refund manual? | Yes | Volume is low. |\n| D-1 | Which"), "D-1"],
    ["a default", swap(LOG, "| X-2 |", "| X-1 | Prices are integers. | Same. |\n| X-2 |"), "X-1"],
    ["a fact", swap(FACTS, "| 1.2 |", "| 1.1 | Chargily is Algerian. | https://chargily.com | doc |\n| 1.2 |"), "1.1"],
    ["a module code", swap(INDEX, "| CHK |", "| CAT | Catalog again | [01-catalog.md](01-catalog.md) | M0 |\n| CHK |"), "CAT"],
    ["a milestone", swap(INDEX, "| M1 | Selling |", "| M1 | Selling |\n| M0 | Foundations again |"), "M0"],
    ["a catalogue entry", swap(CATALOGUES, "| `cart_empty` | 409 | The cart has no lines. |", "| `cart_empty` | 409 | The cart has no lines. |\n| `cart_empty` | 409 | Again. |"), "cart_empty"],
  ];
  for (const [what, files, id] of cases) {
    it(`refuses ${what} defined twice, naming the first definition`, () => {
      const c = check(files);
      expect(c.green).toBe(false);
      expect(of(c, "unique")).toHaveLength(1);
      expect(said(c, "unique")).toMatch(new RegExp(`${id}.*twice.*first at docs/`, "u"));
    });
  }
});

describe("PRDR-280: requirement ids run from 001 without gaps", () => {
  it("refuses a gap, since a removed requirement keeps its id as [withdrawn]", () => {
    const c = check(swap(CATALOG, "**CAT-F-003** [withdrawn]", "**CAT-F-004** [withdrawn]"));
    expect(said(c, "sequence")).toMatch(/CAT-F.*003/u);
  });
});

describe("PRDR-280: every requirement and criterion agrees with the registry", () => {
  it("refuses a code the index does not register", () => {
    const c = check(append(CATALOG, "- **ZZZ-F-001** [M1] The zone MUST exist.\n- **ZZZ-AC-01** [M1] Given a zone, when read, then it exists (ZZZ-F-001)."));
    expect(said(c, "registry")).toMatch(/ZZZ-F-001.*not registered/u);
  });

  it("refuses a requirement outside the PRD its code is registered to", () => {
    const c = check(append(CATALOG, "- **CHK-F-003** [M1] Checkout MUST log every order.\n- **CHK-AC-03** [M1] Given an order, when it is placed, then a log line names it (CHK-F-003)."));
    expect(said(c, "registry")).toMatch(/CHK-F-003.*belongs in docs\/prd\/02-checkout\.md/u);
  });

  it("refuses a milestone the registry does not allow the code", () => {
    const c = check(append(CHECKOUT, "- **CHK-F-003** [M0] Checkout MUST log every order.\n- **CHK-AC-03** [M1] Given an order, when it is placed, then a log line names it (CHK-F-003)."));
    expect(said(c, "registry")).toMatch(/CHK-F-003.*\[M0\].*M1/u);
  });

  it("refuses a registry row naming a module PRD the pack does not have, once, not once per entry", () => {
    const c = check(swap(INDEX, "| CHK | Checkout | [02-checkout.md](02-checkout.md) |", "| CHK | Checkout | [03-checkout.md](03-checkout.md) |"));
    expect(of(c, "registry")).toHaveLength(1);
    expect(said(c, "registry")).toMatch(/03-checkout\.md.*no docs\/prd\/03-checkout\.md/u);
  });

  it("does not report a refused code's entries as unregistered: the code's row has its finding", () => {
    const c = check(swap(INDEX, "| CHK | Checkout | [02-checkout.md](02-checkout.md) | M1 |", "| CHK | Checkout | [02-checkout.md](02-checkout.md) | soon |"));
    expect(of(c, "code")).toHaveLength(1);
    expect(of(c, "registry")).toEqual([]);
  });
});

describe("PRDR-280: every reference resolves", () => {
  const cases: readonly (readonly [string, Files, RegExp])[] = [
    ["a requirement a criterion names", swap(CHECKOUT, "`cart_empty` (CHK-F-001).", "`cart_empty` (CHK-F-009)."), /CHK-F-009/u],
    ["a criterion named in prose", append(ARCH, "Refunds follow CAT-AC-09."), /CAT-AC-09/u],
    ["a decision", swap(ARCH, "(X-1)", "(D-7)"), /D-7/u],
    ["a default", swap(ARCH, "(X-1)", "(X-9)"), /X-9/u],
    ["a fact", swap(ARCH, "facts §1.1", "facts §1.9"), /facts §1\.9/u],
    ["a milestone", append(CATALOG, "- **CAT-F-004** [M5] Tags MUST exist.\n- **CAT-AC-03** [M5] Given a tag, when read, then it exists (CAT-F-004)."), /\[M5\]/u],
    ["the stack's decision", swap(LOG, "| decision | X-2 |", "| decision | X-9 |"), /X-9/u],
    ["a requirement a context document names", withFile("README.md", "# Shop\n\nSee CAT-F-099.\n"), /CAT-F-099/u],
  ];
  for (const [what, files, pattern] of cases) {
    it(`refuses ${what} that nothing defines`, () => {
      const c = check(files);
      expect(c.green).toBe(false);
      expect(said(c, "reference")).toMatch(pattern);
    });
  }

  it("reads a context document for requirement and criterion ids only, and only under registered codes", () => {
    expect(check(withFile("README.md", "# Shop\n\nStep D-9 of X-4 in the runbook.\n")).green).toBe(true);
    expect(check(withFile("README.md", "# Shop\n\nIt follows RFC-F-001 of another spec.\n")).green).toBe(true);
  });

  it("does not read an id inside a longer token as a decision or a default", () => {
    expect(check(append(ARCH, "The row ID-12 and the box XX-3 are examples.")).green).toBe(true);
  });

  it("resolves both ends of a range, and a whole section of the facts", () => {
    expect(said(check(append(ARCH, "See facts §1.1–§1.9.")), "reference")).toMatch(/facts §1\.9/u);
    expect(check(append(ARCH, "See facts §1, and verified-facts §1.2.")).green).toBe(true);
    expect(said(check(append(ARCH, "See facts §3.")), "reference")).toMatch(/facts §3/u);
    expect(said(check(append(CHECKOUT, "Money is architecture §1–§3.")), "section")).toMatch(/architecture §3/u);
  });

  it("refuses a milestone the registry allows a code and the index does not define", () => {
    const c = check(swap(INDEX, "| CAT | Catalog | [01-catalog.md](01-catalog.md) | M0, M1 |", "| CAT | Catalog | [01-catalog.md](01-catalog.md) | M0, M1, M7 |"));
    expect(said(c, "reference")).toMatch(/CAT.*\[M7\]/u);
  });

  it("reports a reference on the line it is on, at the start of a line or inside one", () => {
    const c = check(withFile("README.md", "# Shop\n\nCAT-F-098 is gone.\nSo is CAT-F-099.\n"));
    expect(of(c, "reference").map((f) => [f.line, f.message.slice(0, 11)])).toEqual([
      [3, "`CAT-F-098`"],
      [4, "`CAT-F-099`"],
    ]);
  });

  it("gives one finding for an unknown id a line names twice", () => {
    expect(of(check(append(ARCH, "See CAT-F-099, and again CAT-F-099.")), "reference")).toHaveLength(1);
  });

  it("resolves a section reference against the document's numbered headings", () => {
    expect(check(append(CHECKOUT, "Money is architecture §1.1.")).green).toBe(true);
    expect(said(check(append(CHECKOUT, "Money is architecture §3.")), "section")).toMatch(/architecture §3/u);
    expect(said(check(append(CHECKOUT, "Money is money.md §1.")), "section")).toMatch(/money\.md/u);
    expect(check(append(CHECKOUT, "See §4 of the contract.")).green).toBe(true);
    expect(check(append(CHECKOUT, "It is bound under contract §4.")).green).toBe(true);
  });

  it("resolves a relative link to a file that exists", () => {
    expect(said(check(append(INDEX, "See [the plan](03-missing.md).")), "link")).toMatch(/03-missing\.md/u);
    expect(check(withFile("README.md", "# Shop\n\n[Index](docs/prd/index.md) and [site](https://example.com).\n")).green).toBe(true);
    expect(check(append(INDEX, "See [the root](/README.md) and [a section](01-catalog.md#requirements).")).green).toBe(true);
  });

  it("reads a link shown in backticks as text", () => {
    expect(check(append(INDEX, "A link is written `[x](nowhere.md)`.")).green).toBe(true);
  });

  it("refuses a link out of the repository, whose target would depend on the machine", () => {
    expect(said(check(append(INDEX, "See [the parent](../../../elsewhere.md).")), "link")).toMatch(/outside the repository/u);
  });
});

describe("PRDR-280: every catalogue entry a document uses is in its catalogue, when the pack has one", () => {
  it("refuses an error code, an event and a route the catalogue lacks", () => {
    const c = check(append(CHECKOUT, "- **CHK-F-003** [M1] Refunds MUST answer `409` `refund_closed`, emit `refund.issued` and serve `POST /store/refunds`.\n- **CHK-AC-03** [M1] Given a refund, when it is issued, then it is logged (CHK-F-003)."));
    const text = said(c, "catalogue-use");
    for (const id of ["refund_closed", "refund.issued", "POST /store/refunds"]) expect(text).toContain(id);
  });

  it("matches a route's parameters by position, not by name", () => {
    const files = swap(CATALOGUES, "| `POST /store/checkout` | Places the order. |", "| `POST /store/checkout` | Places the order. |\n| `GET /store/orders/:id` | Reads an order. |");
    const used = { ...files, [ARCH]: `${files[ARCH] ?? ""}An order is read with \`GET /store/orders/:order_id\`.\n` };
    expect(check(used).green).toBe(true);
  });

  it("reads a setting as the noun, not as the verb", () => {
    const settings = `${CONFORMING_PACK[CATALOGUES] ?? ""}\n## Settings\n\n| Setting | Default |\n|---|---|\n| \`max_lines\` | 50 |\n`;
    const files = (line: string) => ({ ...append(ARCH, line), [CATALOGUES]: settings });
    expect(check(files("Checkout reads the setting `max_lines`.")).green).toBe(true);
    expect(said(check(files("Checkout reads the setting `max_items`.")), "catalogue-use")).toContain("max_items");
    expect(check(files("Approval moves the vendor on, setting `approved_at`.")).green).toBe(true);
  });

  it("reads a route only under a first path segment the catalogue's routes use", () => {
    expect(check(append(ARCH, "The load balancer polls `GET /health`.")).green).toBe(true);
    expect(said(check(append(ARCH, "Refunds use `GET /store/refunds/:id`.")), "catalogue-use")).toContain("GET /store/refunds/:id");
  });

  it("reads a segment in capitals as an example value in a parameter's place", () => {
    const files = swap(CATALOGUES, "| `POST /store/checkout` | Places the order. |", "| `POST /store/checkout` | Places the order. |\n| `GET /store/orders/:id` | Reads an order. |");
    expect(check({ ...files, [ARCH]: `${files[ARCH] ?? ""}Order P is read with \`GET /store/orders/P\`.\n` }).green).toBe(true);
  });

  it("reads a bare path as a route's path, or as the namespace of one", () => {
    const orders = swap(CATALOGUES, "| `POST /store/checkout` | Places the order. |", "| `POST /store/checkout` | Places the order. |\n| `GET /store/orders/:id` | Reads an order. |");
    const using = (line: string) => ({ ...orders, [ARCH]: `${orders[ARCH] ?? ""}${line}\n` });
    expect(check(using("Checkout lives at `/store/checkout`.")).green).toBe(true);
    expect(check(using("Everything under `/store/orders` is private.")).green).toBe(true);
    expect(check(using("Every route under `/store/*` is public, and `GET /store/…` pages.")).green).toBe(true);
    expect(said(check(using("Refunds live under `/store/refunds`.")), "catalogue-use")).toContain("/store/refunds");
  });

  it("does not read the catalogue's own prose as a use", () => {
    expect(check(append(CATALOGUES, "A code is answered as `409` `some_code` would be.")).green).toBe(true);
  });

  it("refuses a route cell that is not METHOD /path, and one route listed twice under two parameter names", () => {
    const route = (extra: string) => swap(CATALOGUES, "| `POST /store/checkout` | Places the order. |", `| \`POST /store/checkout\` | Places the order. |\n${extra}`);
    expect(said(check(route("| `/store/orders` | Lists orders. |")), "catalogue")).toMatch(/\/store\/orders.*METHOD \/path/u);
    const twice = check(route("| `GET /store/orders/:id` | Reads an order. |\n| `GET /store/orders/:order_id` | Again. |"));
    expect(said(twice, "unique")).toMatch(/GET \/store\/orders\/:order_id.*twice/u);
  });

  it("checks a kind only when the catalogue has its section", () => {
    const job = append(ARCH, "The job `nightly-payout` pays vendors.");
    expect(check(job).green).toBe(true);
    const withJobs = { ...job, [CATALOGUES]: `${CONFORMING_PACK[CATALOGUES] ?? ""}\n## Jobs\n\n| Job | Schedule |\n|---|---|\n| \`nightly-close\` | 02:00 |\n` };
    expect(said(check(withJobs), "catalogue-use")).toContain("nightly-payout");
    const none = Object.fromEntries(Object.entries(append(CHECKOUT, "It answers `409` `refund_closed`.")).filter(([f]) => f !== CATALOGUES));
    expect(check(none).green).toBe(true);
  });
});

describe("PRDR-280: every requirement has a criterion", () => {
  it("refuses a requirement no criterion tests", () => {
    const c = check(append(CATALOG, "- **CAT-F-004** [M1] Tags MUST exist."));
    expect(said(c, "coverage")).toMatch(/CAT-F-004.*no acceptance criterion/u);
  });

  it("exempts a withdrawn requirement", () => {
    expect(of(check(CONFORMING_PACK), "coverage")).toEqual([]);
  });
});

describe("PRDR-280: milestone order holds", () => {
  it("refuses a criterion that tests a later milestone's requirement", () => {
    const c = check(swap(CATALOG, "the price is 1500 (CAT-F-001).", "the price is 1500 (CAT-F-001, CAT-F-002)."));
    expect(c.green).toBe(false);
    expect(said(c, "milestone-order")).toMatch(/CAT-AC-01.*\[M0\].*CAT-F-002.*\[M1\]/u);
  });

  it("does not read a requirement that names a later one as depending on it, since naming may point forward", () => {
    const c = check(swap(CATALOG, "price in minor units (X-1).", "price in minor units (X-1), which CAT-F-002 later shows."));
    expect(of(c, "milestone-order")).toEqual([]);
    expect(c.green).toBe(true);
  });
});

describe("PRDR-280: a schema break is a blocking finding", () => {
  it("carries the schema's own findings, and they block", () => {
    const c = check(append(CATALOG, "- **CAT-F-004** [M1] Tags exist.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004)."));
    expect(of(c, "requirement")).toEqual([expect.objectContaining({ blocks: true, line: 16 })]);
    expect(c.green).toBe(false);
  });

  it("reports a refused entry once: it is defined, so no reference, gap or untested requirement is reported for it", () => {
    const c = check(
      append(CATALOG, "- **CAT-F-004** [M1] Tags exist.\n- **CAT-F-005** [M1] Tags MUST sync.\n- **CAT-AC-03** [M1] Given a tag, then it exists (CAT-F-004, CAT-F-005)."),
    );
    expect(c.findings.map((f) => [f.rule, f.line])).toEqual([
      ["requirement", 16],
      ["criterion", 18],
    ]);
  });

  it("reads another family's ids under bold heads as prose, not as malformed requirements", () => {
    expect(check(append(CATALOG, "- **S-1**: the spike that settles identity.\n- **OQ-3** is closed.")).green).toBe(true);
    expect(said(check(append(CATALOG, "- **CAT-AC-7** [M1] Given a tag, when read, then it exists (CAT-F-001).")), "requirement")).toMatch(/CAT-AC-7/u);
  });
});

describe("PRDR-280: the present-indicative rule is a heuristic that never blocks", () => {
  it("reports a requirement sentence with no MUST, SHOULD or MAY, and stays green", () => {
    const c = check(append(CATALOG, "- **CAT-F-004** [M1] Tags MUST exist. The catalog indexes them nightly.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004)."));
    expect(of(c, "present-indicative")).toEqual([expect.objectContaining({ blocks: false, file: CATALOG, line: 16 })]);
    expect(said(c, "present-indicative")).toContain("The catalog indexes them nightly.");
    expect(c.green).toBe(true);
  });

  it("reads requirements only: a design document describes the design in the present tense by nature", () => {
    expect(of(check(append(ARCH, "The ledger is already implemented in the core.")), "present-indicative")).toEqual([]);
  });

  it("does not read a requirement's citations and asides, a label or a fragment as sentences", () => {
    const aside = check(swap(CATALOG, "price in minor units (X-1).", "price in minor units (X-1. Settlement is daily)."));
    expect(of(aside, "present-indicative")).toEqual([]);
    const label = append(CATALOG, "- **CAT-F-004** [M1] **Tags and their labels.** Tags MUST exist. Always.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004).");
    expect(of(check(label), "present-indicative")).toEqual([]);
  });

  it("quotes the sentence as it reads without its citations", () => {
    const c = check(append(CATALOG, "- **CAT-F-004** [M1] Tags MUST exist. The catalog indexes (X-1) them nightly.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004)."));
    expect(said(c, "present-indicative")).toContain('"The catalog indexes them nightly."');
  });

  it("says in its own output that the rule is a heuristic", () => {
    const out = renderPackCheck(check(append(CATALOG, "- **CAT-F-004** [M1] Tags MUST exist. The catalog indexes them nightly.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004).")));
    expect(out).toMatch(/heuristic.*never block/isu);
  });
});

describe("PRDR-280: deterministic", () => {
  const broken = append(CATALOG, "- **CAT-F-004** [M1] Tags exist. They sync.\n- **CAT-F-001** [M0] Again MUST.");

  it("gives byte-identical output for the same pack, wherever it lives", () => {
    const [a, b] = [packRepo(broken), packRepo(broken)];
    const run = (root: string) => checkPack(root, discoverDocs(root).docs, { greenfield: true });
    expect(renderPackCheck(run(a))).toBe(renderPackCheck(run(a)));
    expect(renderPackCheck(run(a))).toBe(renderPackCheck(run(b)));
    expect(JSON.stringify(run(a))).toBe(JSON.stringify(run(b)));
  });

  it("names each finding's rule, its file:line and the offending text", () => {
    const c = check(broken);
    const dup = of(c, "unique")[0];
    expect(dup).toMatchObject({ file: CATALOG, line: 17, text: "- **CAT-F-001** [M0] Again MUST." });
    expect(renderPackCheck(c)).toContain(`${CATALOG}:17 [unique]`);
  });

  it("lists findings in place order: file, then line, then rule", () => {
    const c = check({ ...broken, [ARCH]: `${CONFORMING_PACK[ARCH] ?? ""}See CAT-F-099 and [x](nowhere.md).\n` });
    const places = c.findings.map((f) => `${f.file}\u0000${String(f.line).padStart(6, "0")}\u0000${f.rule}`);
    expect(places).toEqual([...places].sort());
    expect(new Set(c.findings.map((f) => f.file)).size).toBeGreaterThan(1);
  });

  it("reads no clock, no network, no environment and no model", () => {
    for (const file of ["pack-check.ts", "pack-check-rules.ts", "pack-check-refs.ts", "pack-parse.ts", "pack-markdown.ts"]) {
      const source = readFileSync(path.join(import.meta.dirname, "..", "..", "src", "init", file), "utf8");
      expect(source).not.toMatch(/\bDate\b|Math\.random|\bfetch\(|process\.env|child_process|node:https?|\.\.\/sessions\//u);
    }
  });
});

describe("PRDR-280: it prints what it does not check", () => {
  it("lists every blind spot, whether the pack is green or red", () => {
    for (const files of [CONFORMING_PACK, append(CATALOG, "- **CAT-F-001** [M0] Again MUST.")]) {
      const out = renderPackCheck(check(files));
      for (const blind of UNCHECKED) expect(out).toContain(blind);
      expect(out).toContain(`${String(UNCHECKED.length)} properties are not checked`);
    }
  });

  it("does not count a green pack as reviewed", () => {
    expect(UNCHECKED.join("\n")).toMatch(/consistent and wrong/u);
  });
});

