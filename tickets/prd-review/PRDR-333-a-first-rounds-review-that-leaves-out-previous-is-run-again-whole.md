---
id: PRDR-333
title: "A first round's reviewer whose findings leave out `previous` is refused, and its whole review is run again. `previous` names the finding of the round before that a finding is what remains of, and a first round's reviewer is given none, so null is the only value it can hold there. On N-8's review set at Opus 5.5 `high`, 5 of the 10 reviewers left it out of every finding, each was relaunched for a second whole review, and the round ran 15 sessions for its 10 reviews; at `max`, none did. A reviewer that leaves it out twice fails VALIDATE. A first round's finding with no `previous` will read as null, and a verification's keeps the field required"
state: OPEN
severity: major
category: defect
labels: ["prd-review", "validate", "C-2¹⁴", "C-4⁗′", "relaunch", "spend", "effort"]
surface: ["src/schemas/validate.ts", "src/init/validate-round.ts", "tests/init/validate-previous.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-2¹⁴", "C-4⁗′", "S-5⁷", "N-8"]
acceptance_criteria: ["A first round's review, a `review` task given no findings of a round before, whose findings leave out `previous`, is taken at its first attempt with each such finding's `previous` null. Nothing is relaunched, and nothing is said about it.", "A verification's review, a `verify` task, whose findings leave out `previous` is refused at its first attempt, as before: there the field names the finding of the round before that a finding is what remains of, and a guess would lose that link.", "A first round's finding that names a `previous` is checked as before: one naming a finding the reviewer was not given is refused.", "The PRD records the rule as C-2²⁸, with the measurement that found it, and C-2¹⁴ carries the amendment.", "Falsifying test, against HEAD: a first round whose reviewer leaves `previous` out of its findings launches that reviewer twice, and fails the phase when the second attempt leaves it out too."]
non_goals: ["Does NOT change the prompt or the skeleton, which already ask for `previous: null`.", "Does NOT relax any other field of a finding, nor `previous` in a verification.", "Does NOT change how a review that fails its checks twice is treated (C-4⁗′)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-284", "PRDR-327", "PRDR-326", "PRDR-116"]
depends_on: ["PRDR-284"]
---

# PRDR-333 — a first round's review that leaves out `previous` is run again whole

## Where this came from

PRDR-327's arm of Opus 5.5 at `high` on N-8's review set, 2026-10-02. It reported 18 of the 18
blockers and passed the bar, but its log shows five lines like this one, each for a different area:

> VALIDATE round 1, Records, layers, history, minimum data, retention and permissions artifact
> unusable (findings.0.previous: Invalid input: expected string, received undefined; …) —
> relaunching once with the validator's own words (C-4⁗′)

Today's setup at `max`, run on the same set the same day, had none.

## Problem

- **The field can hold only null in a first round.** `reviewFindingSchema` requires `previous` on
  every finding: the id of the finding of the round before that this one is what remains of, or
  null for a new one (C-2¹⁴). A first round's reviewer is given no `previous` findings, so every
  finding it reports is new, and null is the one value the field can take. `checkReview` already
  refuses a first round's finding that names anything else.
- **Leaving it out costs a whole review.** `reviewArea` parses the artifact against the schema, and
  a finding without the field makes it unusable. `withOneRelaunch` then runs the reviewer again
  from the start (C-4⁗′). The second session reads the pack's foundations and its own documents
  again and re-does the whole review. On the set at `high`, 5 of the 10 reviewers left `previous`
  out of every finding. The round ran 15 sessions for 10 reviews, and the relaunches were a third of
  its spend.
- **Twice fails the phase.** A second attempt that leaves it out is unusable too, and an unusable
  review fails the round (`the reviewer produced no usable review`). All five relaunches at `high`
  held, but nothing made them hold.
- **It matters most where the routing is going.** S-5⁷ moves a task's effort below `max` only
  through a passing arm, and the reviews' arm at `high` passed. A setting that drops a field half
  the time, where the field carries nothing, should not cost a third of its spend or put the round
  at risk.

## Design

- **A first round's finding with no `previous` reads as null.** In a `review` task, the reviewer
  was given no findings of a round before, so a missing `previous` can only mean null. It reads as
  null, at the first attempt, with nothing said, as PRDR-116 read a verdict's synonyms as meant.
- **A verification's stays required.** In a `verify` task the field names the finding a new one is
  what remains of. A missing value is a link left unsaid, and reading it as null would count a
  finding that remains as fixed and report it again as new. It stays a refusal there.
- **The checks are unchanged.** A first round's finding that names a `previous` is still refused by
  `checkReview`. The prompt and the skeleton still ask for `previous: null`.
- **The PRD:** C-2²⁸, and an amendment note on C-2¹⁴.

### Vetoable calls

1. **Read as null, not prompted harder.** The prompt already says it, and the skeleton shows it. A
   field with one possible value is the parser's to fill.
2. **First rounds only.** A verification's `previous` carries meaning, so leaving it out there stays
   a refusal.
