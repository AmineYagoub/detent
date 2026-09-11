import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { presentStage, renderPresentation, type PresentInput } from "../../src/init/present.js";
import { ADVICE_INLINE_MAX } from "../../src/init/present-advice.js";
import type { HeldFinding } from "../../src/schemas/init.js";
import { removeTree } from "../helpers.js";

/**
 * D-24′ (PRDR-209) — advice a human can act on.
 *
 * gate-313's PRESENT printed 144 held findings as one flat list, twice. Buried
 * in it: the twenty-six tickets at least one read called too big for a
 * session, and which findings survived a paid revision versus which were seen
 * once and never again. Structure, not suppression: everything is still there,
 * the first screen is the part a person can act on.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-present-"));
  roots.push(dir);
  mkdirSync(path.join(dir, ".detent", "state"), { recursive: true });
  return dir;
}

const base = (dir: string): PresentInput => ({ root: dir, tickets: [], bindings: [], skips: [], bootstrap: null, assignments: {}, slices: [], questions: [], derivedEdges: [], gateNotices: [] });

let n = 0;
const f = (ticket: string | undefined, tag: HeldFinding["tag"], held?: HeldFinding["held"]): HeldFinding => {
  n += 1;
  return { tag, finding: `finding ${String(n)} about ${ticket ?? "the plan as a whole"}`, ...(ticket === undefined ? {} : { ticket }), ...(held === undefined ? {} : { held }) };
};

/** A wall: thirty findings, one ticket drawing three tags, two plan-wide, kinds mixed. */
function wall(): HeldFinding[] {
  const out: HeldFinding[] = [
    f("t-s14-013", "sizing", "after-revision"),
    f("t-s14-013", "sizing", "seen-once"),
    f("t-s14-013", "sizing", "seen-once"),
    f("t-s14-013", "testability", "seen-once"),
    f("t-s14-013", "dependency", "after-revision"),
    f("t-s10-002", "sizing", "seen-once"),
    f("t-s10-002", "sizing", "seen-once"),
    f("t-s10-002", "coherence", "after-revision"),
    f(undefined, "coherence", "after-revision"),
    f(undefined, "shape"),
  ];
  for (let i = 0; i < 20; i += 1) out.push(f(`t-s0${String((i % 8) + 1)}-00${String((i % 3) + 1)}`, "dependency", i % 2 === 0 ? "seen-once" : "after-revision"));
  return out;
}

describe("D-24′ held findings render as something a person can act on", () => {
  it("above the inline size: grouped by ticket, the ticket drawing the most tags first, totals by tag and by kind, and the file named", () => {
    const findings = wall();
    expect(findings.length).toBeGreaterThan(ADVICE_INLINE_MAX);
    const text = renderPresentation({ ...base("/tmp/x"), findings, adviceFile: "/tmp/x/.detent/state/advice.md" });
    /* Before PRDR-209: thirty indented `tag (ticket): …` lines and nothing else. */
    expect(text).toMatch(/by tag: .*dependency 21/);
    expect(text).toMatch(/seen in one read[^\n]*\d+/);
    expect(text).toMatch(/held after a paid revision[^\n]*\d+/);
    const top = text.split("\n").find((l) => l.includes("t-s14-013")) ?? "";
    expect(top, "the ticket that drew three tags leads").toContain("sizing ×3");
    const s10 = text.indexOf("t-s10-002");
    expect(s10, "the two-tag ticket follows it").toBeGreaterThan(text.indexOf("t-s14-013"));
    expect(text).toContain("full list: /tmp/x/.detent/state/advice.md");
    expect(text.split("\n").filter((l) => /^ {2}(dependency|sizing|coherence|testability|shape) \(/.test(l)), "no wall").toHaveLength(0);
  });

  it("at or below the inline size: every finding, with its kind", () => {
    const findings = [f("t-s01-001", "sizing", "seen-once"), f("t-s01-002", "dependency", "after-revision"), f(undefined, "coherence")];
    const text = renderPresentation({ ...base("/tmp/x"), findings });
    for (const x of findings) expect(text).toContain(x.finding);
    expect(text).toMatch(/sizing \(t-s01-001\)[^\n]*seen once/);
    expect(text).toMatch(/dependency \(t-s01-002\)[^\n]*held after revision/);
    expect(text).not.toContain("full list:");
  });

  it("presentStage writes the full list to `.detent/state/advice.md` above the size, and names it", async () => {
    const dir = root();
    const findings = wall();
    const outcome = await presentStage({ ...base(dir), findings });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    const file = path.join(dir, ".detent", "state", "advice.md");
    expect(message).toContain(`full list: ${file}`);
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    for (const x of findings) expect(body).toContain(x.finding);
    expect(body).toContain("## t-s14-013");
  });

  it("presentStage writes no file when the list fits inline", async () => {
    const dir = root();
    const outcome = await presentStage({ ...base(dir), findings: [f("t-s01-001", "sizing")] });
    expect(outcome.kind).toBe("interrupt");
    expect(existsSync(path.join(dir, ".detent", "state", "advice.md"))).toBe(false);
  });
});
