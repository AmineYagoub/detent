import { describe, expect, it } from "vitest";
import { QUESTION_SIMILARITY, similarQuestions } from "../../src/init/questions.js";

/**
 * C-3‴ (PRDR-207) — one question, asked once.
 *
 * gate-313 asked the founder the npm-identity question twice: ANALYZE raised
 * it, s14's draft raised it again in its own words, and the batch dedups on
 * exact text. Two paid assumptions, two answers. The stages that drafted were
 * handed what was already asked, and PRESENT merged what still slipped through.
 *
 * C-3⁗, C-4⁵ (PRDR-292): no planning stage asks now, so no draft is handed
 * what was asked, and a draft or a slicing that asks is refused
 * (`plan-inputs.test.ts`). C-7‴ (PRDR-296): PRESENT lists no question, and
 * its merge went with the list (`present-rebuilt.test.ts`). The similarity
 * is what is left: DECIDE refuses a question the decision log already
 * answers by it (`decide-items.ts`), held here to gate-313's pair.
 */

/* gate-313's pair, verbatim. */
const Q1 =
  "Which npm identity publishes Detent, and which repository hosts the Claude Code plugin marketplace entry? Specifically: the package name (unscoped `detent` versus a scope such as `@<org>/detent`), the npm account or organization that owns it, and the marketplace repository the plugin is listed from. v2 records that the previous name was abandoned precisely because it was taken on npm, so registry availability is a fact about accounts the founder owns rather than an engineering choice.";
const Q2 =
  "Which Claude backend credential will the release pipeline and the developer machines hold for the runs that must be live — `doctor`'s smoke session, the M2 budgeted live run, and the permanent N-7 self-build release gate? PRDR-141 records that the supported transports broadened to three and that `doctor` keying on `ANTHROPIC_API_KEY` alone was stale, but the documents do not say which transport this project's own CI is entitled to use, and that is a credential and billing question rather than a design one.";
const S14Q1 =
  "Which legal name should appear as the copyright holder in the MIT `LICENSE` file, and from which year? v3 resolves the licence itself (MIT, chosen 2026-08-20) but records no holder, and the copyright line is an attribution of ownership rather than an engineering choice — an individual, a company, or a project name are different legal claims and only the owner can say which is true.";
const S14Q2 =
  "Which npm identity publishes the headless driver, and which repository hosts the marketplace listing? Specifically: the package name (unscoped `detent` or a scope such as `@<org>/detent`), the npm account or organization that owns it, and whether the marketplace entry is listed from this repository or another one the founder controls. v2 records that the previous product name was abandoned because it was taken on npm, so registry availability is a fact about accounts rather than an engineering choice, and it lands in this slice because these are the two tickets that publish.";

describe("C-3‴ a question asked twice in two stages' words is one question", () => {
  it("gate-313's pair is similar; the two other `Which …` questions are not", () => {
    expect(similarQuestions(Q1, S14Q2), "same question, two drafts").toBe(true);
    expect(similarQuestions(Q1, Q2), "two different founder questions").toBe(false);
    expect(similarQuestions(S14Q1, S14Q2)).toBe(false);
    expect(QUESTION_SIMILARITY).toBeGreaterThan(0);
  });
});
