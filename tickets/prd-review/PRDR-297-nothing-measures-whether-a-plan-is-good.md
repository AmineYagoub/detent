---
id: PRDR-297
title: "Nothing measures whether a plan is good. So September judged 79 planning tickets by reviewer finding counts, which its own experiments showed track the reviewer, and ksar-cloud's plan was assembled by at least four Detent builds, one slice of it from an experiment run against the live tree. Run-time outcomes are now recorded per ticket and aggregated per plan with the build and pack that made it; a planning mechanism must name the outcome it should move; and a plan's builds are recorded and shown"
state: DONE
severity: major
category: capability
labels: ["prd-review", "planning-redesign", "operator-decision", "measurement", "evaluation"]
surface: ["src/kernel/run.ts", "src/kernel/ledger.ts", "src/cli/status.ts", "src/cli/report.ts", "src/schemas/records.ts", "src/init/machine.ts", "src/init/present.ts", "src/cli/init.ts", "src/cli/run.ts", "src/cli/approve.ts", "detent-prd-v3.md", "tests/kernel/plan-quality.test.ts"]
prd_refs: ["X-4", "X-4′", "X-4″", "X-1⁵", "F-3", "F-4", "N-7", "C-7", "PRDR-081", "PRDR-255", "PRDR-276", "PRDR-278"]
acceptance_criteria: ["Per ticket, from `transitions.jsonl` and the ledger: escalations to NEEDS_HUMAN, falsifications by cause (premise, oversized, dependency discovered), budget breaches, whether it was done in its first generation, review rounds, cost and wall-clock.", "Per slice and per plan, together with the Detent build and the pack hash that produced the plan: `detent status` shows a quality section, and the end of a run writes a record of it.", "The PRD states the rule. A planning mechanism that claims to improve plans names the outcome it should move, and a measured run in which that outcome does not move is grounds to remove the mechanism. Reviewer finding counts are not an outcome.", "Every planning checkpoint records the Detent build that wrote it, and PRESENT names every build that contributed. A plan more than one build produced is approved the way a toolchain install is (PRDR-276): on a TTY, PRESENT asks [y/N] after naming the builds, and so does `run`'s deferred approval (PRDR-255); off one, `--approve` needs `--accept-mixed-builds` beside it, or the approval is refused. The approval record lists the builds.", "A test replays a recorded run's transitions and ledger, and asserts the per-ticket and per-plan figures.", "`detent status` shows what each specification phase and planning cost. No cap or threshold applies (the specification plan's decision 16)."]
non_goals: ["Does NOT gate anything on these numbers. They are evidence for the operator's decisions, not a stop.", "Does NOT forbid experiments. It records which build made what, so an experiment's output cannot pass for the real plan."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-081", "PRDR-255", "PRDR-269", "PRDR-276"]
depends_on: ["PRDR-278"]
---

# PRDR-297 — run-time outcomes, and evaluation hygiene

## Where this came from

The planning audit of 2026-09-26, §1, §2 and §7:
- about 19 of 79 planning tickets have live evidence of a result, and only PRDR-081's effect was
  measured on execution (67/67 DONE on the 3.1.0 gate);
- s07 of ksar-cloud's approved plan is the draft of the "no revision" experiment arm;
- the plan came from at least four builds.

## Problem

Without an outcome, every planning change is judged by proxies. The proxy September used, finding
counts, measures the reviewer. And a plan whose parts came from different builds and an experiment
cannot be attributed to any one of them.

## Design

The redesign plan's §10. The operator's decision 3 makes run-time outcomes the bar. `run` already
records every event the figures need, so this ticket aggregates and attributes; it measures nothing
new.

## From PRDR-296

PRESENT shows what each specification phase and planning cost (C-7‴), and the last criterion can
read the same figures:
- Every ledger row an `init` session writes names the phase that launched it, in `phase`, a string.
  A run's rows name none.
- `phaseSpend(root)` in `src/init/phase-spend.ts` sums `init`'s rows by phase: AUDIT, DECIDE, WRITE
  and VALIDATE apiece, SLICE and PLAN as planning, then any other phase by its name, then the rows
  that name none, as earlier. `readLedgerRows(root)` in `src/kernel/ledger-rows.ts` is X-1's reader,
  returning the rows that `readRecordedSpend` sums.
- `detent status` shows none of it yet.

C-7″'s mixed builds are left to this ticket's fourth criterion: no checkpoint records its build,
and PRESENT names none.

## Building it

N-5′ is built, and so are C-7″'s mixed builds; the PRD records both as N-5″, and N-5′, C-7″ and
C-7‴ point to it. `src/kernel/outcomes.ts` counts each ticket's figures, `src/kernel/plan-quality.ts`
sums them per slice and per plan and records them when a run ends, `src/kernel/build.ts` names the
running build, and `src/init/plan-builds.ts` lists the builds that made a plan and renders PRESENT's
lines for them. `detent status` shows the figures, then `init`'s spend by phase.

The acceptance criteria, as built:
1. **Per ticket.** `ticketOutcomes(ids, transitions, ledger)` counts, from `transitions.jsonl` and
   the ledger alone:
   - *escalations:* lines into NEEDS_HUMAN, less each OUTAGE_REQUEUE, since an outage's stop was no
     human's to clear (PRDR-112);
   - *falsifications by cause:* PREMISE_FALSIFIED, TICKET_OVERSIZED and DEPENDENCY_DISCOVERED;
   - *budget breaches:* BUDGET_BREACH;
   - *DONE in its first generation:* the DONE line's generation equals the ticket's outage
     requeues, so a generation an outage opened is not held against it;
   - *review rounds:* REVIEW_APPROVE and REVIEW_CHANGES, each review that reached a verdict;
   - *cost:* the ledger rows that name the ticket;
   - *wall-clock at work:* from each line that leaves the ticket working to the line after it.
     READY, BLOCKED, NEEDS_HUMAN and DONE are waits, and nothing after the last line is counted.
2. **Per slice and per plan.** `planQuality(root)` sums them over `plan.json`'s tickets, over each
   slice's, and over the tickets no slice holds, apart. Beside them are the builds and the pack's
   hash that made the plan, as `approval.json` records them, or `presentation.json` where the plan
   is not approved; an approval given before builds were recorded names none. A torn line of
   `transitions.jsonl` gives up the objects written whole in it (PRDR-249), and each line that is
   not a transition is counted as unreadable.
   - `detent status` shows, after the tickets, a line for the plan, what made it, a line for each
     slice and one for the tickets outside any, and how many lines it could not read, with no
     internal state name (C-13).
   - `run` ends, whether its loop returned or threw, by appending a `plan_quality` event to
     `runs/run/journal.jsonl`, where each run's `config` event is (PRDR-092): the same figures, each
     ticket's too, and `run_build`, the build that ran it. A record that cannot be made is
     announced, and the run's exit is its loop's.
3. **The rule.** D-33 states it, since PRDR-278, as this criterion does: a mechanism names the
   outcome it should move, a measured run in which it does not move is grounds to remove it, and
   reviewer finding counts are not an outcome. N-5″ adds nothing to it, and names it as the rule
   the figures serve.
4. **The builds.**
   - A build is `<version>+<12 hex>`, the hex from a sha256 over every file under `src/` and
     `prompts/` and `package.json`, by path and content, computed once per process. It is in no
     key.
   - Every checkpoint records the build that wrote it, and so do the cut SLICE keeps (`builds`),
     each slice's cache, and each redraft the checks across the plan used.
   - PRESENT names the builds of what `detent init --replan` makes again: the checkpoints from
     DETERMINE_VERIFICATION to PREPARE_AGENTS, the cut, the planned slices' caches and the
     redrafts, each build with what it made. A record without the field, or one that will not
     parse, counts as `unrecorded`. One build is named on one line, with the pack; more, or any
     unrecorded, are listed under a header that says approval needs acceptance.
   - Where the builds are mixed and approval is asked, PRESENT asks whether they are accepted after
     the presentation is shown and before C-7's question, which is put only on a yes. A no, or no
     answer, interrupts AWAIT_APPROVAL with `MIXED_BUILDS_REFUSED`, which names `--replan` and both
     ways to accept, and carries the presentation where nothing printed it. On a terminal
     `makeTtyMixedBuilds` asks `[y/N]`, and only y or yes accepts. Off one,
     `--accept-mixed-builds` is the answer given in advance: `--approve` without it is refused, and
     `--decline` and `--defer` approve nothing and need none. `run`'s deferred approval asks the
     same question on a terminal, from `presentation.json`'s `builds`, before C-7's.
   - `approval.json` records `builds` and `pack_hash` on both exits, and `presentation.json`
     requires both.
   - The plugin's `init` skill tells the host to ask the human before it relays
     `--accept-mixed-builds`, and the README says what PRESENT names and how a mixed plan is
     approved or made again.
   `tests/init/mixed-builds.test.ts` pins the stamps, what PRESENT reads and prints, and both flows
   through `presentStage` and the pipeline. `tests/cli/init-mixed-builds.test.ts` drives
   `detent init` over the conforming pack, off a terminal and on one, and
   `tests/cli/run-approval.test.ts` drives `run`'s deferred approval.
5. **The replay.** `tests/kernel/plan-quality.test.ts` writes a recorded run's transitions and
   ledger line by line, as `run` writes them: six tickets over two slices and one outside any, with
   a false premise and a requeue, a dependency found and a budget breach, a ticket too large, an
   outage and its requeue, a blind fix and a round of changes. It asserts each ticket's figures,
   the per-slice and per-plan sums, what made the plan, the count of torn and foreign lines, and
   `detent status`'s lines. Another case holds the figures of a ticket still in review when they
   are taken. A last case runs the kernel on a fixture repo and finds the record its run ended with.
6. **What each phase cost.** `detent status` ends with PRDR-296's block, the one PRESENT shows:
   AUDIT, DECIDE, WRITE and VALIDATE apiece, SLICE and PLAN as planning, with no cap. Where the
   ledger cannot be read, it says why and still lists the tickets.

### Vetoable calls

1. **A build is a digest of what runs, not a version or a commit.** Every build of an unreleased
   line shares its version; a commit misses an uncommitted edit, which is what an experiment is,
   and an installed plugin has no repository behind it. `package.json` is in it because it pins
   the SDK whose binary runs the sessions (S-5). Tests, docs and skills are not, since none changes
   what a session is given or runs.
2. **The build is in no key** (C-8). An upgrade that changes nothing a phase reads reuses its
   checkpoints, and PRESENT says which build wrote each.
3. **PRESENT names the builds of what `--replan` makes again, not every build that wrote a
   checkpoint.** The pack is the founder's document set, and its hash names it; the specification
   phases' checkpoints record their builds all the same. Counting them, or INIT_FS and DISCOVER,
   which write nothing the plan holds, would call every plan made after an upgrade mixed, and a
   question put to every plan is answered unread. This is a reading of the criterion's "every
   build that contributed".
4. **An unrecorded part counts as mixed.** It may have been several builds, so a plan resumed
   across the upgrade to this build is asked about once, or made again with `--replan`.
5. **A kept cut keeps its builds, and a cut added to joins this build to them.** A requirement
   that leaves the cut adds no session's work to it, so it adds no build.
6. **The question comes after the presentation and before C-7's,** as PRDR-276's install question
   comes after what it installs, and its default is no.
7. **`--accept-mixed-builds` wins where it is given,** on a terminal too, as the answer given in
   advance. `--decline` and `--defer` need none.
8. **`run` has no flag for it.** Off a terminal `run` has no asker for C-7's question either, and
   refuses an unapproved plan as before; `detent init --approve --accept-mixed-builds` approves it.
9. **A refusal is AWAIT_APPROVAL, exit 2,** as a decline is, and the plan stays READY-unapproved.
10. **`presentation.json` requires `builds` and `pack_hash`, and `approval.json` has them
    optional.** A presentation without them was written before them, so `detent init` presents
    again. An approval outlives the build that wrote it, and one without them stays approved, with
    figures that name no build.
11. **An outage is taken out of the escalations and the first generation** (PRDR-112), since the
    stop was not the ticket's.
12. **Only working states count toward time at work.** A ticket in the pool, blocked or on a human
    is waiting, and after its last line nothing is known.
13. **A ticket's figures are its whole history.** No line or row marks the plan it ran under, so a
    re-plan that keeps a ticket's id keeps its figures.
14. **The run's record is a journal event, not a file of its own,** beside the `config` event the
    run began with, so each run's figures stay with what it ran under. `detent status` computes
    them from the files when it runs.
15. **They are not in `detent report`,** whose metrics are §14's table, key for key (T-053).
16. **`detent status` shows the plan's and each slice's figures, not each ticket's,** which would
    bury them in a plan of hundreds of tickets; each ticket's are in the run's record.
17. **Dollars to four decimals,** as PRESENT's spend, and time in seconds, minutes, or hours and
    minutes.
18. **An approval without builds names none,** even where a later presentation does, since that
    presentation is not what the approval was given for.

## Falsification (verification protocol, item 1)

The final test files were copied into a `git archive` of HEAD `6d4ff96` in the scratchpad and run
there, against HEAD's source, so the working tree was not touched. The copy holds every test file
that differs from HEAD: three new suites and four changed ones. `git diff` in the copy shows its
`src/`, `prompts/`, `skills/` and `scripts/` as HEAD's.
- **The three new suites cannot load at HEAD:** each imports `src/kernel/build.ts`, which HEAD
  lacks.
- **Six of the changed suites' 71 cases fail.** `run-approval`'s three PRDR-297 cases: HEAD's `run`
  puts C-7's question to a plan two builds made without asking about them, whether or not an
  answer for them is given, and its approval names no build. `golden-path`'s two PRDR-256 cases:
  `cli/init.ts` and `cli/run.ts` wire no mixed-build asker. `present-rebuilt`'s record case: HEAD
  refuses a presentation record that carries `builds` and `pack_hash`. `migrate.test.ts` passes at
  HEAD; it only passes `recordApproval` its new argument.

```
 × takes no answer for the builds as a no: an approver alone is never asked
   → expected 1 to be +0
 × a yes puts the approval question, and the approval lists the builds and the pack
   → expected { schema_version: 2, …(3) } to match object { approved_by: 'reviewer-human', …(2) }
 × every declared site exists, and still does what it is exempt for
   → WIRES exempts cli/init.ts for makeTtyMixedBuilds, which it no longer contains — …
 Test Files  6 failed | 1 passed (7)
      Tests  6 failed | 65 passed (71)
```

Since the new suites cannot load at HEAD, a probe written against exports HEAD has was run there
and in the working tree, then deleted. Each of its four cases fails at HEAD for the defect's own
reason, and all four pass with the change:

```
 × a checkpoint and a slice's cache name the build that wrote them
   → PLAN's checkpoint names its build: expected undefined to deeply equal Any<String>
 × a plan an older build planned part of is not approved without the operator accepting that
   → PRESENT names the older build: expected 'Plan ready for approval.\n\nVerificat…' to contain '3.0.9+0123456789ab'
 × `detent status` shows the plan's run-time outcomes and what init spent by phase
   → expected 'planning (4)\n  t-001-bootstrap — Boo…' to contain 'Run-time outcomes'
 × a run ends by recording the plan's outcomes in its journal
   → expected '{"event":"config","at":"2026-09-27T19…' to contain '"event":"plan_quality"'
      Tests  4 failed (4)
```

## Mutation battery (verification protocol, item 2)

The battery ran 77 mutants, one defect each, against the three new suites, `run-approval` and, for
the redraft, `plan-redraft`. Each file was restored from a snapshot, never by `git checkout`, and at
the end all 18 files matched the snapshot directory. The mutants covered:
- **The build:** a part that names no build taken for one build; a repeated build taken for two;
  the prompts, the manifest, a nested file or a file's bytes left out of the digest; the version
  not read.
- **Per ticket:** an outage's stop counted as an escalation, or its generation held against the
  ticket; time on a human or in the pool counted as work; approvals or changes not counted as
  rounds; a dependency counted as a premise; oversizing or breaches not counted; every ticket's
  cost given to each; DONE taken as the first green gate; the totals counting done tickets as
  first-generation ones; work counted after the last line.
- **Per plan and the record:** a torn line recovering nothing; a line that is not a transition not
  counted; the presentation read before the approval, or filling an older approval's builds; the
  tickets outside the slices holding every ticket, or never shown; a slice summing the plan; the
  record naming no run build, or not written; the run not recording at its end.
- **Approval:** PRESENT or `run` not asking about mixed builds, or taking no answer as a yes; the
  builds or the pack not persisted; the approval naming no build, on either exit; the builds not
  shown; the refusal dropping the plan where nothing printed it; the question asked before the plan
  is printed.
- **What PRESENT names:** the specification phases, or PRESENT, counted; the cut, its builds, the
  slices' caches or the redrafts not read; a record that will not parse skipped rather than
  counted unrecorded; mixed builds shown as one; an unrecorded part unexplained; no pack shown as a
  pack.
- **What records it:** a kept cut taken for this build's, or an addition keeping only the old
  builds; an unrecorded cut taken for this build's; a slice's cache, a redraft or a checkpoint
  naming no build; `writeCheckpoint` dropping it; PRESENT given no builds, no pack or no asker.
- **`detent status`:** no figures, no spend, unreadable lines unsaid, hours shown as minutes, no
  slice lines, a failure's reason unsaid, an approval without builds named.
- **The CLI and the records:** the flag ignored; a decline needing acceptance; no terminal question
  at `init`; `run` wiring no asker; an empty answer accepting; the presentation's builds or pack
  optional; the approval's builds required; a checkpoint refusing a build.

First pass: 73 killed, 4 survived.
- **O11** (DONE taken as the first green gate) and **O13** (work counted after the last line)
  survived because every ticket in the replay ended DONE, on a human or in the pool, and each whose
  gate went green was DONE in that generation. A case now counts a ticket still in review when the
  figures are taken: not done, though its gate went green, and at work up to its last line. Under
  O13 the count threw on it.
- **R4** (`run` taking no answer for the builds as a yes) survived because both `run` cases gave an
  answer. A case now gives an approver alone, off a terminal, and it is never asked.
- **X1** (a redraft naming no build) survived because the cases that read a redraft's build wrote
  the record themselves. A case now has the checks across the plan send s01 a redraft, and finds
  this build on it and among what PRESENT names.

Second pass: O11, O13, R4 and X1, 4 killed. So all 77 are killed.

## Gates

`lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and `test` all
pass: 2162 tests passed and 2 skipped, across 182 files. `npm run plugin` builds, and leaves
`agents/` and `hooks/dist/` as they were.

## Found along the way

Nothing outside what this ticket changes needed fixing. What it found and left is below.

## Recorded, not fixed

- **Time between a crash and the resume counts as work.** A ticket's time at work runs from a line
  that leaves it working to the next line, and a crash writes no line: B-5 records the launch it
  skips in the ticket's journal. So a run that dies with a ticket in IN_PROGRESS and resumes an
  hour later counts the hour. The journal's `start`, `end` and `skipped_after_crash` records could
  bound it.
- **`detent report` drops a torn line whole.** Its own reader of `transitions.jsonl` and the ledger
  skips any line that does not parse, where PRDR-249's `recoverObjects` gives up the objects
  written whole in it, as this ticket's reader does. Two whole lines a torn write glued together
  are both lost to its metrics.
