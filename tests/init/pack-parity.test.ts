import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { checkPack, type PackCheck } from "../../src/init/pack-check.js";
import { packRepo } from "./pack-fixture.js";

/**
 * PRDR-280 — parity with the checker's seed, ksarjs's `check_pack.py`.
 *
 * `tests/fixtures/pack/` is a pack in the ksarjs pack's shapes: topic
 * subsections in the decision log, an amendment, facts in numbered sections,
 * a catalogue with a table that is not a catalogue, multi-method and
 * alternative routes, criteria that open with their ids, an example value in
 * a route, spikes under bold heads. Its content is its own: the ksarjs pack
 * is unpublished, and this repository is public. On it the checker reports
 * what the script reported on ksarjs, nothing; and each of the script's catch
 * types, seeded into it, is reported, as the script reported it on ksarjs in
 * PRDR-280's parity run (the wording is the script's, in each test's name).
 * The script's ksarjs-only catches (frontmatter, its PRD section template,
 * its permission catalogue, its process leftovers, its spikes) are not ported.
 */

const FIXTURE = path.join(import.meta.dirname, "..", "fixtures", "pack");

function fixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(FIXTURE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(FIXTURE, abs).split(path.sep).join("/")] = readFileSync(abs, "utf8");
  }
  return files;
}

function check(files: Readonly<Record<string, string>>): PackCheck {
  const root = packRepo(files);
  return checkPack(root, discoverDocs(root).docs, { greenfield: true });
}

const said = (c: PackCheck, rule: string) =>
  c.findings
    .filter((f) => f.rule === rule)
    .map((f) => f.message)
    .join("\n");

describe("PRDR-280: on a pack in ksarjs's shapes the checker reports what check_pack.py reported on ksarjs, nothing", () => {
  it("is green with no finding and no heuristic report", () => {
    expect(check(fixture())).toEqual({ green: true, findings: [] });
  });
});

describe("PRDR-280: seeded with check_pack.py's catches, it reports each", () => {
  const LENDING = "docs/prd/01-lending.md";
  const MEMBERS = "docs/prd/02-members.md";
  const ARCH = "docs/design/architecture.md";
  const cases: readonly (readonly [string, string, string, string, RegExp])[] = [
    ["CAT-F-001 defined twice", LENDING, "- **LND-F-001** [M1] Loans MUST exist twice.", "unique", /LND-F-001.*twice/u],
    ["ZZZ-F-001 uses unregistered code", LENDING, "- **ZZZ-F-001** [M1] The zone MUST exist.", "registry", /ZZZ-F-001.*not registered/u],
    ["CHK-F-074 belongs in 03-checkout-orders.md", LENDING, "- **MEM-F-002** [M1] A member MUST have a name.", "registry", /MEM-F-002.*belongs in docs\/prd\/02-members\.md/u],
    ["CAT-F-077 has no milestone tag", LENDING, "- **LND-F-006** Loans MUST be listed.", "requirement", /LND-F-006.*milestone/u],
    ["COM-F-026 tagged ['M2'], registry allows ['M1']", MEMBERS, "- **MEM-F-002** [M2] A member MUST have a name.", "registry", /MEM-F-002.*\[M2\].*M1/u],
    ["CAT-F: not sequential from 001 (missing [77])", LENDING, "- **LND-F-007** [M1] Loans MUST be listed.", "sequence", /LND-F.*006/u],
    ["references undefined CAT-F-999", ARCH, "See LND-F-099.", "reference", /LND-F-099/u],
    ["D99 does not exist", ARCH, "As D-99 says.", "reference", /D-99/u],
    ["X99 does not exist", ARCH, "As X-99 says.", "reference", /X-99/u],
    ["facts §9.9 does not exist", ARCH, "See facts §9.9.", "reference", /facts §9\.9/u],
    ["architecture §99 does not exist", ARCH, "See architecture §9.", "section", /architecture §9/u],
    ["POST /store/nonexistent not in api-conventions §7", ARCH, "Call `POST /member/nonexistent`.", "catalogue-use", /POST \/member\/nonexistent/u],
    ["path /store/nonexistent/path not in api-conventions §7", ARCH, "See `/member/nonexistent/path`.", "catalogue-use", /\/member\/nonexistent\/path/u],
    ["broken link nowhere.md", ARCH, "See [x](nowhere.md).", "link", /nowhere\.md/u],
    ["error code `no_such_code` (409) not in catalogues §1", ARCH, "It answers `409` `no_such_code`.", "catalogue-use", /no_such_code/u],
    ["event `no.such_event` not in catalogues §2", ARCH, "It emits `no.such_event`.", "catalogue-use", /no\.such_event/u],
    ["job `no-such-job` not in catalogues §4", ARCH, "The job `no-such-job` runs.", "catalogue-use", /no-such-job/u],
  ];
  for (const [seed, file, line, rule, pattern] of cases) {
    it(`reports what the script reported as "${seed}"`, () => {
      const files = fixture();
      const c = check({ ...files, [file]: `${files[file] ?? ""}\n${line}\n` });
      expect(c.green).toBe(false);
      expect(said(c, rule)).toMatch(pattern);
    });
  }
});
