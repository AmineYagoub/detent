---
id: PRDR-281
title: "Contradictions inside the documents and wrong external facts reach planning unexamined. ksarjs's raw PRD put negotiation both in the MVP and in phase 2, and never knew that Medusa 2.21's store routes drop a linked field unless it is allow-listed. An AUDIT phase finds contradictions and gaps, checks each external claim against a primary source at the pinned version, and, in an existing project, checks the documents against the code"
state: DONE
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "C-3″", "roles"]
surface: ["src/init/audit.ts", "src/init/audit-claims.ts", "src/init/audit-passages.ts", "src/init/audit-key.ts", "src/init/pipeline.ts", "src/init/plan-write.ts", "src/init/machine.ts", "src/init/config.ts", "src/init/discover-docs.ts", "src/schemas/audit.ts", "src/schemas/init.ts", "src/schemas/roles.ts", "src/sessions/guard.ts", "src/fs/layout.ts", "src/kernel/migrate.ts", "src/cli/init.ts", "prompts/audit.md", "prompts/manifest.json", "skills/", "README.md", "detent-prd-v3.md", "tickets/prd-review/PRDR-282-money-legal-and-policy-questions-are-asked-after-the-plan-is-drafted.md", "tickets/prd-review/PRDR-284-the-pack-is-never-validated-and-a-review-loop-has-no-stop-rule.md", "tickets/prd-review/PRDR-298-the-redesign-leaves-behind-code-whose-job-has-moved.md", "tests/"]
prd_refs: ["C-2⁶", "C-2⁷", "C-2¹¹", "C-3″", "C-3a", "C-8", "F-3", "F-3″", "F-4", "S-1", "S-1′", "S-1‴", "S-5⁵", "X-1⁵", "X-6a", "S-5′", "S-5‴", "PRDR-084", "PRDR-119", "PRDR-278", "PRDR-294"]
acceptance_criteria: ["AUDIT runs after DISCOVER on a document set that is not a conforming pack. Its checkpoint lists contradictions, each with both passages quoted at their `file:line`; gaps; and external claims.", "Each external claim carries its source (a link, or a dependency path at the pinned version) and a verdict: confirmed, wrong or unverified. An unverified claim is never recorded as a fact.", "In an existing project, the documents are also checked against the code, and a document that states as built what the code does not do is a finding.", "Its sessions run as a new `audit` role with its own prompt (`prompts/audit.md`), routed to `claude-opus-5-5` at `max` (decision 14), and are read-only (S-1′). They read the repository, including dependency sources at their pinned versions, and reach the web under the research role's network rules. `planning_research_tool_calls` is counted and reported against AUDIT's research and never told to a session as a share to stay within (C-2⁶, PRDR-278). The role shares one F-3 `schema_version` event with `spec_write`, `spec_review` and PRDR-294's `plan_review`: whichever lands first bumps the version and writes the migration for `role@hash` assignments, and the others extend it before a release (decisions 11 and 15).", "Its checkpoint is keyed by the discovered documents and the code, never by the decision log, so answering DECIDE's questions never re-runs AUDIT.", "A completed AUDIT is a progress mark for the no-progress breaker (X-1⁵, PRDR-284).", "A test drives AUDIT with a stub session over a two-document fixture that contradicts itself, and asserts that both passages reach the checkpoint."]
non_goals: ["Does NOT decide anything; DECIDE does (PRDR-282).", "Does NOT reuse the research role or its prompt. On 2026-09-26 the operator chose a role of its own (decision 11): one job per prompt.", "Does NOT run on a conforming pack (decision 6), and nothing else skips it: there is no switch (decision 10)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-282", "PRDR-266", "PRDR-294", "PRDR-300"]
depends_on: ["PRDR-278", "PRDR-300"]
---

# PRDR-281 — AUDIT

## Where this came from

The ksarjs audit was the first step, and the cheapest place a defect was found. It found
contradictions inside the raw PRD. Negotiation was in the MVP according to the summary, the
endpoint list and an acceptance test, and in phase 2 according to the roadmap and the modules
table. It also found facts the PRD never knew: since Medusa 2.21.0, store routes drop a linked
field unless it is allow-listed, so a product's vendor would silently vanish from responses.
Every fact went into `research/verified-facts.md` with its source.

## Problem

ANALYZE reads the documents to plan from them, not to doubt them. A contradiction becomes an
assumption (C-3″), and an external claim is taken as written. Neither is looked at again until
a session meets it.

## Design

The plan's §3. AUDIT's checkpoint is the input DECIDE works from: every contradiction becomes a
question or a default there, and every external claim goes into the facts file with its verdict.
In an existing project, AUDIT is also where the documents meet the code already built.

What building it settled, each recorded in the PRD as C-2¹¹ and open to the operator's veto:

1. **Raw only.** AUDIT runs on a raw document set. The first criterion says "not a conforming
   pack", but C-2⁷ says a changed pack is re-validated for the change only and never treated as
   raw PRD, so a changed pack goes to VALIDATE (PRDR-284). On a conforming or changed pack, AUDIT
   completes without a session and says why.
2. **Two steps, one role.** One survey session reads every document, and the code in an existing
   project. It writes contradictions, gaps, drift and the external claims, unchecked. Then each
   claim gets a session of its own that checks it and writes a brief. Both are `audit` sessions
   on the one prompt, told which task by their inputs, so the non-goal holds: the research role
   and its prompt are not used. What moves in from C-3a is the engine and the brief format:
   - a per-claim cache;
   - one relaunch with the validator's words;
   - X-6a's local-search rule, and PRDR-266's ascent for an `unverified` verdict;
   - the counted pool, with no share told to any session.
3. **Claim briefs are committed** at `.detent/research/audit/<hash>.json`, a new committed layout
   entry, as planning briefs are. The hash covers the claim and its subject, the dependency at
   its pinned version. So a re-run pays nothing for a claim it has checked, and a version bump
   checks it again.
4. **Quotes are checked by code.** Every passage the survey cites (a contradiction's two, a
   drift's, a claim's) must be found, whitespace aside, at its `file:line`. A survey with a
   passage that is not there is relaunched once with the list. A passage still not there is
   dropped, counted in the checkpoint and said. A brief whose `confirmed` or `wrong` verdict
   cites a repository path that does not exist is refused the same way.
5. **The checkpoint key** covers three things: the documents' contents without the decision log,
   the code, and the audit prompt's hash. The code is every tracked or changed file outside the
   documents, the decision log, `.detent/` and `archive/`. The survey is not shown the decision
   log either, so nothing it read escapes its key. The machine gains a standalone key: a phase
   that declares one is looked up by its own digest, even while the phases before it replay.
   That is how an answer re-runs DECIDE and never AUDIT. DECIDE writes
   `docs/founder-decisions.md`, which changes DISCOVER's listing and replays everything after
   DISCOVER except AUDIT.
6. **Progress.** Each claim brief written is a progress mark, as a slice's checkpoint is, and so
   is AUDIT's completion. An audit of forty claims would otherwise have the breaker announce at
   its twentieth session.
7. **Routing.** `audit` runs on `claude-opus-5-5` at `max` (S-5⁵). The v1→v2 migration (F-3″)
   writes that routing into an existing config that routes no `audit`, model and effort
   separately, and leaves a routed one alone (S-5′).
8. **Nothing reads the checkpoint yet.** DECIDE (PRDR-282) is its reader. Until then AUDIT's note
   says what it found, and planning goes on as before.

Settled while building, also recorded in C-2¹¹ and also open to veto:

9. **More checks by code than the list above.** A gap's passages are checked as the others are.
   The code a drift finding names must exist. A verdict's `source` must have the lines it cites,
   and may not be one of the documents being checked, which cannot settle a claim they make.
10. **Strict, then repaired.** The first survey is refused for anything missing, so the relaunch
    hears all of it. The second is kept with what stands: the rest is dropped and counted, and a
    document it still says it did not read is recorded as `unread` and said. The phase fails only
    on a survey the schema refuses twice, as ANALYZE does.
11. **One check, every place.** A claim the documents rely on in several places is checked once,
    and each place is recorded with the verdict, since WRITE will need each one.
12. **Standalone means both ways.** Besides being looked up while the phases before it replay, a
    standalone phase replays nothing after it when it runs, and it is never a re-plan, so C-8″'s
    in-flight refusal does not count it. Otherwise an edit to the code, which AUDIT's key covers
    and nothing after it reads, would re-plan the product. `replayedFrom` names the first phase
    that ran, the standalone one included.
13. **The code, as git sees it.** The key's code is every file git tracks or would track, as the
    working tree has it, and a root git cannot list gets discovery's walk instead.
14. **The note lists findings,** up to ten of each kind, since until DECIDE it is the only place
    they reach a person.
15. **The routing note is built from the tables,** where it named each role by hand and would have
    left `audit` out.
16. **`planOutputIntact` moved** from `pipeline.ts` to `plan-write.ts`, beside the writer whose
    output it checks, to keep `pipeline.ts` within its 300 lines.

## Falsification (verification protocol, item 1)

The four test files this ticket adds, run against HEAD `0aa7208`. The run used a copy of that
commit made with `git archive`, so the working tree was not touched:

```
 ❯ tests/init/machine-standalone.test.ts (4 tests | 4 failed)
   × … is looked up by its own key while the phases before it replay
   × … replays nothing after it when it runs
   × … is not forced by --replan, which enters after it (C-8⁵)
   × … is not a re-plan, so a ticket in flight does not refuse it (C-8″)
 ❯ tests/init/audit-role.test.ts (9 tests | 8 failed)
   × … is a role, routed to claude-opus-5-5 at max (specification decision 14)
     → expected [ 'planner', 'diagnose', …(6) ] to include 'audit'
   × … is read-only, has no stop gate, and reaches the web as research does (S-1′)
   × … has a prompt of its own, pinned in the manifest
     → .toMatch() expects to receive a string, but got undefined
   × … runs as AUDIT, directly after DISCOVER (C-2⁶)
     → expected -1 to be 2
   × … is named, with its model and effort, where `init` tells the operator what it routed
     → (0 , routingNote) is not a function
   × … writes audit's default model and effort into a config that routes other roles but not audit
     → expected { planner: 'claude-fable-5-1' } to deeply equal { planner: 'claude-fable-5-1', …(1) }
   × … leaves a routed audit as the config says, model and effort separately
     → expected {} to deeply equal { audit: 'max' }
   ✓ … leaves a routing table that is not a table for the config's reader to refuse
   × … gives a config that never routed anything the new role's routing alone
     → expected undefined to deeply equal { audit: 'claude-opus-5-5' }
 FAIL  tests/init/audit-checks.test.ts
Error: Cannot find module '../../src/init/audit.js'
 FAIL  tests/init/audit.test.ts
Error: Cannot find module '../../src/init/audit-claims.js'
```

What each says:
- **`audit.test.ts` and `audit-checks.test.ts` do not load.** The modules they drive do not
  exist, and that is the defect: nothing reads the documents before ANALYZE plans from them,
  nothing checks an external claim, and nothing checks that a quote is where it is said to be.
  Each of their 55 tests is shown to bite by the battery below instead.
- **`audit-role.test.ts`:** there is no `audit` role, no prompt, no AUDIT phase and no
  `routingNote`, and the v1→v2 migration leaves a config with no routing for the role. The one
  passing test is a guard on the new transform's restraint: at HEAD there is no transform, so a
  malformed table is left alone there too.
- **`machine-standalone.test.ts`:** at HEAD AUDIT is not a phase, so the machine never runs its
  handler, and it has no standalone key. The battery's seven machine mutants show each rule of
  the key biting on its own.

The first run, before any code was written, had `audit-role.test.ts`'s first eight tests failing
the same way, and `audit.test.ts` not loading. The other tests were written with the code, from
the checks the battery found unasserted.

## Mutation battery (verification protocol, item 2)

91 mutants, one defect each, run against the four new test files and the machine, `init` CLI,
migration, prompt, layout and config-default suites. Each file was restored from a snapshot copy,
never by `git checkout`, and its hash checked. On the final code all 90 that apply are killed.
The 91st was the walk's archive check, deleted as equivalent (below). They cover:
- the phase: the first survey not strict and the second not repaired; no progress mark at
  completion or on a pack; a conforming or a changed pack audited; AUDIT on the chain; the survey
  shown the decision log; the prompt, the pack kind or the markers left out of the key; an old
  DISCOVER checkpoint read as a conforming pack; every project greenfield; the claims not checked;
  a stale survey read; the unread not counted; the sessions run as `research`; the turns not
  counted;
- what is said: the findings, the drops, the unread, the research said with no claims or never,
  the listing uncapped, and each relaunch not told why;
- the claims: one checked twice; only the first place recorded, or a later place given a verdict
  of its own; the cache ignored; another claim's brief taken; the source not checked; the brief not
  committed; no mark per brief; an unchecked claim read as checked; the subject out of the hash,
  or the hash not normalized; a stale artifact read; the skeletons missing, or the unverified one
  carrying a source;
- the checks by code: whitespace; a quote starting on a later line, or not crossing one; a
  passage outside the documents; the unread; drift in greenfield or on code that is not there; a
  document settling its own claim; a source's lines, a backwards range, line zero and a final
  newline counted as a line; a file or code outside the root;
- the key: the decision log in the contents or counted as code; `.detent/` and `archive/` counted
  as code; the walk entering dependency trees; deleted, untracked and ignored files; the code left
  out;
- the machine: the standalone key chained, or carried on; not looked up while replaying; replaying
  the rest; counted as a re-plan; `replayedFrom` renamed by a later miss or a forced replay;
- the role: the config not routed, a routed `audit` overwritten, a malformed table rewritten,
  effort routed as a model; the note dropping a group, or not printed; `audit` off the web, given
  a stop gate, not read-only, or below `max`; AUDIT out of the pipeline; the briefs off the layout;
- the schemas: a settled verdict with no source, an unverified one with one, a correction on a
  confirmed claim, every verdict made to escalate, tier 3 not counted as outside, no local search
  before the web, a one-sided contradiction, and drift with no code read.

The first run, of 89 mutants, killed 86. The three survivors:
- **No progress mark at completion.** The test asserted a mark existed. The ledger pins one at
  the spend when it first launches a session, so a mark existed whether AUDIT completed or not.
  The test now asserts the mark moved to the survey's spend.
- **Whitespace not set aside.** Every test quote crossed a line break, which joining the lines
  covers on its own. A test now has a double space and a tab inside a line, in the document and in
  the quote.
- **The walk entering the archive: equivalent.** `codeFiles` drops `archive/` from whatever lists
  the files, so the walk's own check changed nothing. It was deleted.

Decision 11 came after that run. `checkClaims` had checked a claim once and recorded only its
first place. It now records every place with the one verdict, and it is split in two: `check`
gives one hash its verdict, and the loop records each place. The eleven claim mutants were
re-anchored on it, and two were added: only the first place recorded, and a later place given a
verdict of its own. A second check of the same claim would now be answered by the cache the first
wrote, not by a session, so the test asserts the research tally as well: one session, no cache
hits. The second run, of 17 mutants (the survivors, the claim mutants and the two added), killed
all 16 that apply.

## What changed

- **`src/init/audit.ts`** (new): the phase.
  - `auditPhase`: a standalone phase after DISCOVER. On a conforming or changed pack it completes
    without a session and says why; on a raw document set it runs `auditStage` in one journal.
  - `auditStage`: the survey, relaunched once with the issues it had and then repaired; then the
    claim checks; then the notes, the progress mark and the checkpoint.
  - `auditNotes`: the counts, and each contradiction, drift, wrong claim and unverified claim, ten
    of each at most; the research counted against `planning_research_tool_calls`; the findings
    dropped; the documents left unread.
  - `auditSurveySkeleton`, and `surveyPath`, cleared before each launch (D-19).
- **`src/init/audit-claims.ts`** (new): `checkClaims`, which records every place a claim is
  relied on with its one verdict, and `check`, one session per claim and subject, with its cache,
  its relaunch, its committed brief and its progress mark; `claimHash`, `auditBriefPath`,
  `claimArtifactPath` and `claimBriefSkeletons`, one skeleton per verdict.
- **`src/init/audit-passages.ts`** (new): `passageAt`, `sourceIssue` and `checkSurvey`, the checks
  by code.
- **`src/init/audit-key.ts`** (new): `auditKey`, `codeFiles` and `auditedDocuments`. Where git
  cannot list the root, the key walks it as discovery does.
- **`src/schemas/audit.ts`** (new): the survey and the claim brief, with `requireVerdictArm` and
  `requireEscalationBeforeUnverified`; the brief reuses `requireLocalSearchBeforeWeb`.
- **`src/init/machine.ts`**: `PhaseHandler.standalone`. `runInit` keys such a phase by its own
  digest, looks it up while earlier phases replay, and never sets the replay for later ones;
  `wouldReplan` skips it; `replayedFrom` stays the first phase that ran.
- **`src/init/pipeline.ts`**: AUDIT after DISCOVER. `planOutputIntact` moved to
  `src/init/plan-write.ts`, beside the writer whose output it checks, to keep the file within
  AGENTS.md's 300 lines.
- **The role:**
  - `src/schemas/roles.ts`: `audit`, routed to `claude-opus-5-5` at `max`, and read-only;
  - `src/sessions/guard.ts`: no stop gate, and the research role's tools;
  - `src/schemas/init.ts`: AUDIT in `INIT_PHASES`, and `EXTERNAL_TIER` exported;
  - `prompts/audit.md` (new), and `prompts/manifest.json` regenerated. `agents/` and the hook
    bundle do not change: `audit` is an init role, which the plugin does not vendor.
- **`src/kernel/migrate.ts`**: the v1→v2 entry's second transform, `routeAdded`, on
  `.detent/config.json`.
- **`src/init/config.ts`**: `routingNote`, built from the routing tables; **`src/cli/init.ts`**
  prints it in place of two sentences that named each role by hand.
- **`src/fs/layout.ts`**: `research/audit`, committed. **`src/init/discover-docs.ts`** exports
  `SKIP_DIRS`, which the key's walk shares.
- **Docs:** `detent-prd-v3.md` C-2¹¹, with pointers on C-2⁶, C-2⁹, C-8‴ and S-1‴; the README and
  `skills/init/SKILL.md` name the nine phases and say what AUDIT does.
- **Other tickets:** PRDR-282, PRDR-284 and PRDR-298 each gain a "From PRDR-281" section naming
  what they inherit.
- **Tests:**
  - `tests/init/audit.test.ts` (31), `tests/init/audit-checks.test.ts` (24),
    `tests/init/audit-role.test.ts` (9) and `tests/init/machine-standalone.test.ts` (4);
  - `tests/init/plan-fixture.ts`: `CLEAN_AUDIT`, an audit that reads every document and finds
    nothing, which the 17 files that drive the whole pipeline now route `audit` to;
  - pins moved: the phase order (`machine.test.ts`, `backhalf.test.ts`), the role ids and the
    read-only set (`prompts.test.ts`), the committed layout (`layout.test.ts`), the effort
    routing and the servable pairs (`config-defaults.test.ts`), the init skill's phases
    (`golden-path.test.ts`), and the routing note (`cli/init.test.ts`, which now asserts the note
    itself);
  - `migrate.test.ts`'s rich state routes `audit` already, so its tests still see the restamp
    alone;
  - `plan-quality.test.ts`: the failed-session case reads the planner's journal row, and the
    breaker case sets the multiple low, because AUDIT's completion is now the first unit.

## Recorded, not fixed

- **Nothing reads the checkpoint yet.** DECIDE (PRDR-282) is its reader. Until it lands, AUDIT's
  findings reach a person only through its note, and planning goes on from the documents as
  written, contradictions included. PRDR-282 now says what it inherits: the checkpoint's shape,
  its digest duty as a standalone phase's reader, and a note that becomes false the day it lands.
- **A changed pack is not validated.** C-2⁷ gives it to VALIDATE (PRDR-284), which is not built.
  Until then a changed pack reaches planning unaudited, as every document set did before this
  ticket, and AUDIT's note says so. No production path writes a conformance record yet, so only
  a hand-made record reaches this.
- **One survey reads every document.** On a document set the size of ksarjs's, one session may
  not hold it all. The survey says what it did not read, and that is recorded as `unread` and
  said, but nothing splits the survey. That wants a live run's evidence first.
- **Claims are checked one at a time.** D-28′'s batches could launch them together; this is
  speed, not correctness.
- **The survey could read the decision log.** It is not given the log and its prompt says not to
  read it, but S-1′'s read-only surface allows reading any file, so the key cannot know if it
  did.
- **Some things are the session's word.** Code checks the verdict's `source`, not the evidence
  entries, which may name a page in prose. It takes a link as given, since checking one would
  mean fetching it. And `documents_read` is the session's own claim: code can refuse a survey
  that admits skipping a document, and cannot tell one that read nothing and says it read
  everything.
- **The key reads every code file on every `init`.** Hashing contents is simple and exact; for a
  repository of many thousands of files, git's blob ids for unmodified tracked files would be
  cheaper. Not measured.
- **Planning research stays in ANALYZE** until PRDR-298 removes it, so for now two phases report
  tool calls against `planning_research_tool_calls`, each its own.
