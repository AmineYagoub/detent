---
id: PRDR-298
title: "The redesign leaves behind code whose job has moved or never started: planning research whose answers no phase reads, the question machinery DECIDE replaces, setup-consent code only a test imports, and doc-blocks that describe a spend gate PRDR-265 removed. Each is deleted with its tests, and every stale doc-block the planning audit names is corrected"
state: DONE
severity: normal
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "deletion", "doc-claim-drift"]
surface: ["src/init/plan-research.ts", "src/init/questions.ts", "src/init/consent.ts", "src/init/allowlist.ts", "src/init/pipeline.ts", "src/init/session.ts", "src/init/launch-batch.ts", "src/init/retry.ts", "src/init/symbol-reminder.ts", "src/init/contracts.ts", "src/init/present.ts", "src/init/plan-slices.ts", "src/init/plan-write.ts", "tests/init/"]
prd_refs: ["C-3a", "C-3‴", "X-1⁵", "PRDR-207", "PRDR-262", "PRDR-264", "PRDR-265", "PRDR-278", "PRDR-281"]
acceptance_criteria: ["Planning research is gone from `init`'s planning phases. AUDIT (PRDR-281) reuses its engine and the brief format of PRDR-262/264, and no planning phase launches a research session.", "`questions.ts`, PRESENT's question merge and renumbering, and PLAN's question inputs are gone; DECIDE owns questions.", "`consent.ts`, `allowlist.ts`, `bootstrapBlocks` and `planPath` are gone, with the tests that were their only callers.", "Every stale doc-block the audit names is corrected: the spend-gate wording in `session.ts`, `launch-batch.ts` and `plan-slices.ts`; `retry.ts:2`; `symbol-reminder.ts:55`; `contracts.ts:19`; `present.ts:49`.", "The ticket records `src/init`'s line counts before and after."]
non_goals: ["Does NOT delete the research role; `run` still uses it.", "Does NOT touch AWAIT_SETUP_CONSENT, which `bind.ts` still raises."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-262", "PRDR-264", "PRDR-265"]
depends_on: ["PRDR-290", "PRDR-291", "PRDR-292", "PRDR-293", "PRDR-294", "PRDR-295", "PRDR-296"]
---

# PRDR-298 — delete what the redesign replaces

## Where this came from

The planning audit of 2026-09-26, §5:
- research answers are never read by SLICE, PLAN or PRESENT;
- `consent.ts` and `allowlist.ts` are imported only by `tests/init/backhalf.test.ts`;
- the spend-gate wording in `session.ts:343`, `launch-batch.ts:11-15` and `plan-slices.ts:490`
  predates PRDR-265, after which nothing refuses a launch.

## Problem

Code that no longer does its job still has to be read, tested and kept consistent. September's
patches kept most of what they replaced, and doc-blocks went on describing mechanisms that had
changed underneath them.

## Design

The redesign plan's §11. This lands last, after the tickets that replace each piece, so nothing is
deleted before its replacement works.

## From PRDR-281

AUDIT has its own claim checker (`src/init/audit-claims.ts`), so taking planning research out of
ANALYZE removes nothing AUDIT uses: it shares `withOneRelaunch`, the X-6a refinements in
`src/schemas/init.ts` and `EXTERNAL_TIER`, and not `plan-research.ts`. Until then each of the two
phases reports its own tool calls against `planning_research_tool_calls` (C-2¹¹).

## From PRDR-282

DECIDE and PRESENT use `similarQuestions` from `src/init/questions.ts`: DECIDE refuses a question
the log's decisions already answer, and PRESENT names each planning question the log answers
(`answeredByLog`) rather than asking it. Removing the question machinery keeps that function or
moves it; the rest of `questions.ts` is this ticket's to remove.

## From PRDR-290

ANALYZE was planning research's one caller, so since PRDR-290 no phase launches a research
session, and `src/init/plan-research.ts` has no caller in `src/`: the first criterion's second
half holds, and the file is this ticket's to delete. Its tests drive it directly: the T-063 cases
in `tests/init/stages.test.ts`, `research-batch.test.ts`, `research-contract.test.ts`,
`research-share.test.ts` and the planning half of `tests/kernel/x1-counting.test.ts`. X-1's site
map names `init/audit` for `planning_research_tool_calls`. SLICE no longer takes `open_questions`;
PLAN's drafts still do, from the slices before them.

## From PRDR-292

No planning stage asks (C-3⁗, C-4⁷). SLICE's slicing and PLAN's draft have no `questions`, and one
carrying any is refused. `openQuestionsInput` and `openQuestionsInstruction` are gone from
`src/init/questions.ts`, and no planning session is handed open questions. What is left has
nothing to feed it:
- PRESENT still gathers SLICE's and PLAN's `questions` outputs, renumbers and merges them
  (`mergeSimilar`), and renders them with `answerInstruction`.
- `questions.ts` keeps `mergeSimilar`, and `similarQuestions`, which DECIDE uses.

Deleting what planning no longer feeds is this ticket's second criterion.

## From PRDR-294

`src/init/launch-batch.ts` is deleted, with `init`'s batch plumbing: the review's draws were its one
caller, and VALIDATE's reviewers launch one after another. So the fourth criterion's
`launch-batch.ts` wording went with the file. What it leaves has no producer:
- `SessionSpec.onFirstResponse` and `artifactTold` in `src/sessions/backend.ts`; the
  `includePartialMessages` switch, the first-`message_start` signal and the told-path redirect in
  `src/sessions/sdk.ts`; the redirect's alias in `src/sessions/guard.ts`; and the mock's call in
  `src/sessions/mock.ts` (S-6′, C-4⁗⁵). No `init` or `run` session sets either field.
- `scripts/plan-corpus.ts` keeps `readLedger` and `ledgerSpend` only to feed `readPlannedRoot`,
  now that `scripts/null-review.ts` is deleted.

## From PRDR-296

PRESENT lists no question (C-7‴). Its question list is gone, with the renumbering, `mergeSimilar`,
`PresentQuestion`, `answeredByLog`, `answerInstruction` and `planQuestionSchema`, and so is the
AWAIT_INFO a blocking question raised, with `presentation.json`'s `blocking`. What is left of the
second criterion:
- `src/init/questions.ts` holds `similarQuestions` and its two helpers alone, which DECIDE uses
  (`src/init/decide-items.ts`). Moving them beside DECIDE deletes the file.
- DISCOVER still writes `patterns_searched` to its outputs, and nothing reads it: PRESENT's answer
  instruction was its one reader.
- `planningBriefSchema`'s doc-block in `src/schemas/init.ts` says C-3′ carries an undecidable
  question to PRESENT on its assumption. Nothing does. The schema's one reader is
  `src/init/plan-research.ts`.

## Building it

What the redesign replaced is deleted, with the tests that drove it alone, and what the planning
audit named as describing more than the code does now says what it does. The PRD records it as
C-3⁵, placed after C-3⁗, and C-3⁗, D-10″, C-4⁷, C-4⁸, C-7‴, S-6′, C-4⁗⁵, C-2⁶, C-2¹¹, the
C-6/C-6a line of the inheritance note and the N-7 scoping note point to it. It amends by name what
v2 states and v3 inherits: C-3a and D-11, C-6 and C-6a with SEC-1 and D-15, X-6's closing sentence
and F-1's committed set.

The acceptance criteria, as built:
1. **Planning research is gone from `init`.** Deleted: `src/init/plan-research.ts`; from
   `src/schemas/init.ts`, `planningBriefSchema`, `PlanningBrief` and the two refinements only it
   used (`requireOutcomeArm`, `requireEscalationBeforeUndecidable`); `InitSessionRequest.withWeb`,
   the switch to the research role's tools that nothing set; the research prompt's planning arm;
   and `research/planning` from the layout. Their tests went with them: `research-batch`,
   `research-contract` and `research-share`, the T-063 cases in `tests/init/stages.test.ts` and
   the planning half of `tests/kernel/x1-counting.test.ts`, whose AUDIT half
   `tests/init/audit.test.ts` covers. No planning phase launched research since D-10″.
   - AUDIT keeps what it shared (PRDR-281): `withOneRelaunch`, `requireLocalSearchBeforeWeb`,
     whose doc-block now names the two briefs it serves, a failing ticket's and a claim's, and
     `EXTERNAL_TIER`. The research role stays: `run` launches it, and its prompt answers a failing
     ticket alone.
   - An older root's briefs under `research/planning` stay committed, since `.detent/.gitignore`
     lists only the local set, and nothing reads them. The layout's doc-block says so.
2. **DECIDE owns questions.** `similarQuestions`, with its threshold and its tokens, all that was
   left of `src/init/questions.ts` after PRDR-296, is in `src/init/decide-items.ts` beside
   DECIDE's `answeredBy`, its one caller, and `questions.ts` is deleted. Its test is renamed
   `tests/init/question-similarity.test.ts` and imports it from there. PRESENT's merge and
   renumbering and PLAN's question inputs were gone already (C-7‴, C-4⁷). DISCOVER no longer
   records `patterns_searched`, whose one reader was PRESENT's answer instruction; AWAIT_DOCS
   still lists the patterns searched, from DISCOVER's own run.
3. **The setup-consent engine is gone.** `src/init/consent.ts` and `src/init/allowlist.ts` are
   deleted, and so are `bootstrapBlocks` and `planPath` in `src/init/plan.ts`, with the 7 cases of
   `tests/init/backhalf.test.ts` that were their only callers; the one remaining use of `planPath`
   there reads the path itself. Three places still described the engine to an operator, and now
   say that Detent runs no setup command: AWAIT_SETUP_CONSENT's brownfield message in
   `src/init/bind.ts`, the refusal outside a repository in `src/cli/init.ts`, which named T-065,
   and item 4 of `skills/init/SKILL.md`. AWAIT_SETUP_CONSENT is raised where it was, as the
   non-goal requires.
4. **The stale doc-blocks the audit named.**
   - *The spend-gate wording.* `session.ts`'s module doc, `spendCeiling`, `launchOnce`'s comment
     and the S-4′ note and message now say that a launch's spend is read against X-1's advisory
     total and the no-progress breaker, which announce and refuse nothing (PRDR-265).
     `plan-slices.ts`'s `noteUnitComplete` says the breaker measures from a completed unit and only
     announces. `launch-batch.ts` went with PRDR-294.
   - *`retry.ts:2`.* Its title is one relaunch for an artifact its validator refused, and its doc
     lists who uses it; the plan review relaunches by its own loop. Its second note no longer says
     the phase fails, since AUDIT records such a claim unverified and goes on: the caller says what
     follows.
   - *`symbol-reminder.ts:55`.* The reminder said the couplings were ones Detent could have checked
     mechanically. Symbol tools reach only the sessions `detent run` launches
     (`referee-session.ts`), so it now says that, and that planning's sessions do not get them.
     `config.ts`'s doc said the same thing, and is corrected.
   - *`contracts.ts:19`.* It listed four checks, the fourth four tickets editing one file. No check
     does that: tickets that write one file declare no contract, and only two that both provide it
     are caught, as a duplicate. The header names what each of the three checks, and says so.
   - *`present.ts:49`.* `readPresentation`'s doc-block says null where the file will not parse, and
     JSON that was not JSON threw. The code now does what the doc says, and `plan-quality.ts`'s
     `madeBy` drops the catch it kept for the throw.
5. **Size.** `src/init` held 68 files, 12,281 lines and 7,895 code lines at `b9c9059`, and holds 64
   files, 11,566 lines and 7,537 code lines: 4 files, 715 lines and 358 code lines fewer. Code
   lines are counted with comments and blank lines left out.

Also deleted, from PRDR-294's section: `SessionSpec.onFirstResponse` and `artifactTold`; in
`src/sessions/sdk.ts`, the `includePartialMessages` switch, the first-`message_start` signal and
the told-path redirect, so `buildPreToolUseHook` takes the policy and the effort callback alone;
`ArtifactAlias` and `carryArtifact` in `src/sessions/guard.ts`; the mock's call; and, in
`scripts/plan-corpus.ts`, `readLedger`, `ledgerSpend` and the `spend` field they fed. The C-4⁗⁵
cases in `tests/sessions/sdk.test.ts` went with the signal, and one case keeps PRDR-072's rule
that a stream that dies reports the `assistant` frames it completed.

The suite loses 73 cases with what they tested and gains 22: 21 in
`tests/init/redesign-leftovers.test.ts`, and one in the similarity test after the battery.

### Vetoable calls

1. **AWAIT_SETUP_CONSENT's words change, and the interrupt does not.** The non-goal keeps the
   interrupt. Its brownfield message offered an allowlisted setup command no path could propose,
   and an operator told of an offer waits for one.
2. **The PRD amends C-6 and C-6a by name rather than leaving them inherited.** No operator was ever
   offered a setup command, so this records what was always true, and v3's inheritance note says
   an inherited rule's meaning changes only where a dated entry names it.
3. **`similarQuestions` moves into `decide-items.ts`** rather than a module of its own: DECIDE is
   its one caller, and a file for twenty lines is the fragmentation AGENTS.md warns of.
4. **`readPresentation` is fixed in code, not in its doc-block.** Every caller already refuses on
   null; a throw reached `run`'s deferred approval as a crash.
5. **`research/planning` leaves the layout, and nothing removes it from an older root.** Its briefs
   are committed history, and deleting a committed directory is the operator's call.
6. **`requireLocalSearchBeforeWeb` and `EXTERNAL_TIER` stay in `src/schemas/init.ts`,** the
   section renamed for what it now holds, rather than moving beside AUDIT: the failing ticket's
   brief (A-4) reads them too.
7. **`planning_research_tool_calls` keeps its name.** Renaming a budget key is an F-3 event for
   every config on disk, and C-2⁶ keeps the name.
8. **The source-text checks stay as tests.** Five cases hold that a stale phrase is gone from the
   file the audit named. They are guards against its return, not proofs of behaviour, and the
   behaviour each phrase described has its own case where one exists.
9. **The orphaned and stacked doc-blocks this touched are merged or moved onto their
   declarations** (`cli/init.ts`, `pipeline.ts`, `machine.ts`, `bind.ts`), and no repository-wide
   check is added: most of the 90 stacked blocks a search finds are file headers above a first
   declaration, which is the house style.
10. **The similarity's two token rules are held by a case each** (its lowercase and its
    four-letter floor), added when the battery showed neither was: DECIDE refuses a question on
    them.

## Falsification (verification protocol, item 1)

The final `tests/init/redesign-leftovers.test.ts` and `tests/init/question-similarity.test.ts` were
copied into a `git archive` of HEAD `b9c9059` in the scratchpad and run there, against HEAD's
source. 21 of their 22 cases fail, each on what it tests:

```
 × gate-313's pair is similar; the two other `Which …` questions are not
   → TypeError: (0 , similarQuestions) is not a function          (it is in questions.ts)
 × its module and the launch switch that gave a planner the web are gone
   → expected true to be false                                    (plan-research.ts exists)
 × its brief schema and its cache directory are gone
   → expected [ 'INIT_PHASES', 'INTERRUPTS', …(20) ] to not include 'planningBriefSchema'
 × the research prompt answers a failing ticket alone
   → expected 'You are the Research agent (read-only…' not to contain 'PLANNING question'
 × the similarity DECIDE uses is DECIDE's own, and questions.ts is gone
   → expected true to be false
 × DISCOVER records no search patterns, which nothing reads
   → expected [ 'docs', 'patterns_searched', …(4) ] to not include 'patterns_searched'
 × its modules, and the plan seams only tests used, are gone
   → src/init/consent.ts: expected true to be false
 × AWAIT_SETUP_CONSENT offers no setup command, since Detent runs none
   → expected 'Detent found no way to run: test.\n\n…' not to match /propose|allowlist/u
 × `detent init` outside a repository promises no engine
   → expected 'not a git repository — `detent init` …' not to match /T-065|setup-consent engine/u
 × the init skill does not say Detent runs setup commands
   → expected '---\ndescription: Prepare a repositor…' not to contain 'executes setup commands'
 × `readPresentation` returns null for a file that will not parse, as its doc-block says
   → SyntaxError: Unterminated string in JSON at position 43 (line 1 column 44)
 × the symbol reminder says which sessions symbol tools reach: `run`'s, never planning's
   → expected '\nSymbol intelligence is not configur…' not to contain 'could have checked mechanically'
 × a second unusable artifact is not announced as a failed phase: its caller says what follows
   → expected 'claim brief artifact unusable (no art…' not to contain 'the phase fails'
 × five cases: each file still holds the stale phrase the audit named
 × no session asks for the event stream: nothing waits on a first response
   → expected true to be false
 × the guard carries no write from a told path to another
   → expected [ 'SPAWN_TOOLS', 'matchAny', …(9) ] to not include 'carryArtifact'
 × the plan corpus reads no ledger it reports to nobody
   → expected [ 'readPlannedRoot', …(4) ] to not include 'readLedger'
 Test Files  2 failed (2)
      Tests  21 failed | 1 passed (22)
```

The one that passes, that AUDIT's claim briefs keep X-6a's rule, is a guard that the deletion keeps
what AUDIT shares, and holds on both sides. The similarity's second case, added after the battery,
was not in the archive run; it passes against HEAD's `questions.ts` too, since the rules it holds
are unchanged.

## Mutation battery (verification protocol, item 2)

26 mutants, one defect each, run against `redesign-leftovers` and the suites that cover each file,
and restored from a snapshot, never by `git checkout`; at the end all 14 files matched it. They
covered:
- **The presentation:** a torn file throwing again.
- **The similarity:** the threshold raised or dropped; the union overcounted; short tokens kept;
  case kept; DECIDE matching exact words only, or refusing nothing.
- **The relaunch:** the second note saying the phase fails, missing, or not naming its issue.
- **What operators are told:** the symbol reminder promising a mechanical check, or naming no
  sessions; AWAIT_SETUP_CONSENT offering a command; the refusal outside a repository promising the
  engine; the skill saying Detent runs setup commands.
- **What is gone stays gone:** DISCOVER recording its patterns; the event stream asked for;
  `research/planning` back in the layout; the research prompt's planning arm; the launch gate in
  `session.ts`; the fourth check in `contracts.ts`.
- **What is kept stays kept:** every frame counted as a turn; a brief citing a page without a local
  search, or a URL not recognised; `research/audit` out of the layout.

First pass: 23 killed, 2 survived, and 1 the harness filed as broken.
- **QS4** (short tokens kept) and **QS5** (case kept) survived: gate-313's pair decides neither
  rule. The similarity test gained a case that each decides, and a second pass killed both.
- **RP1** (a torn presentation throws) was filed as broken because the harness reads `SyntaxError`
  in the output as a failed transform. Run by hand, the one failure is the `readPresentation` case,
  on the `SyntaxError` the mutant throws.
- **PR1** was killed before its case ran, by the manifest's pin of the prompt's hash. Run again by
  hand with the manifest regenerated, as an author who edits a prompt would, it is killed by the
  research prompt's case.

All 26 are killed, and PR1's variant with them.

## Gates

`npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and
`test` all pass: 2111 tests passed and 2 skipped, across 180 files. `npm run plugin` builds, and
rewrites `agents/research.md` from the prompt.

## Found along the way

- **`questions.ts:9`,** which the redesign plan's §11 names beside the ticket's list, went with the
  file. Its doc-block moved with `similarQuestions`, and said the four-letter floor drops "which",
  a five-letter word the tokens keep; it says so now.
- **`sessionDeps` spread `note` twice** (`src/init/session-deps.ts`); the first went.
- **Orphaned and stacked doc-blocks** in the files this touched: three at the end of
  `src/cli/init.ts` (PRDR-086, PRDR-114, C-2‴) documented nothing, and neither did one above
  `buildPipeline`, whose subject moved to `session-deps.ts`; they are deleted. `machine.ts`'s
  approval projection had three blocks stacked, one naming a hash the next declaration does not
  compute; they are one block, and `planHash` has its own. `bind.ts`'s C-4 block sat above
  `languageKey` and is on `provisionalBindingsFor`, which it describes.
- **`newTicket` took `deps` to void it** (`src/init/plan-write.ts`); it takes what it reads.
- **`config.ts`** told the symbol reminder's story as couplings "that code could have checked";
  it now says the tool stayed off in every session.
- **`docs/plan-audit-remediation.md`'s row on `consent.ts`** asked to wire or delete it, and to fix
  two latent defects first: no traversal guard, and an allowlist that admitted
  `npm install ../../evil`. Deletion settles both, since no code is left to hold them.

## Recorded, not fixed

- **No research or audit session can fetch a page.** S-3 grants `WebFetch` per configured docs
  domain, and nothing configures one: `docsDomains` is declared in `PipelineDeps`,
  `InitSessionDeps` and `SdkBackendConfig`, and no caller sets it, in `init` or `run`, so
  `researchTools` returns `WebSearch` and the read-only tools alone. AUDIT's claim checks and
  `run`'s failure research search the web and cannot read a primary source's page. PRDR-062 is
  DONE and was to give the list a config home, and `doctor.ts` and `referee-session.ts` both still
  say it has none. This predates the ticket, and a config key for it is a change to
  `config.json`'s schema, so it needs its own ticket.
