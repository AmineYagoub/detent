---
id: PRDR-277
title: "A ticket left NEEDS_HUMAN on a premise its session found false stays stranded after `run` installs the toolchain that premise lacked — `detent run --install-toolchain` on ksar-cloud would install Go and exit 10 on t-001-bootstrap, which all 546 other tickets list as a blocker. The operator's decision: the yes that installs the toolchain also returns those tickets to the queue, and the run moves on"
state: DONE
severity: major
category: defect
labels: ["prd-review", "found-by-live-run", "D-34", "D-36", "toolchain", "X-4", "operator-decision"]
surface: ["src/kernel/referee-sweeps.ts", "src/kernel/referee.ts", "src/kernel/referee-session.ts", "src/kernel/dependency.ts", "src/kernel/run-toolchain.ts", "src/kernel/run.ts", "src/cli/run.ts", "detent-prd-v3.md", "docs/plan-contracts-and-symbols.md", "tests/kernel/run-toolchain-resume.test.ts"]
prd_refs: ["X-4", "X-4′", "X-8", "X-8′", "C-5", "C-10", "C-12", "D-4", "F-2", "PRDR-112", "PRDR-274", "PRDR-276"]
acceptance_criteria: ["On a yes to a toolchain install at the start of `run`, every ticket that is NEEDS_HUMAN with the kernel's X-4 note (`falsified mid-implementation:`) still its last word returns to READY through `HUMAN_REQUEUE`, the consent naming what was installed, in a fresh generation whose reason names the install and carries the falsification. The ticket's notes say why. It happens at the pool's first draw, so the same run claims the ticket and moves on.", "The yes is informed. The message `run` shows before it asks lists each ticket a yes would return, with the premise its session found false. With no one to ask, the refusal says a yes would also return them. `--install-toolchain` is the same answer for both.", "Only X-4's own signal, and only untouched. A NEEDS_HUMAN whose last word is anything else — a person's note, an outage, a dependency X-4′ could not resolve, a fix ladder that ran out — is left where it is, as PRDR-112's outage sweep leaves a ticket a person has touched.", "Only on an install. With nothing missing, nothing is asked and nothing is returned. A declined or unanswered install returns nothing.", "The PRD records it as X-4⁶ after X-4⁵, with the install boundary it rests on (PRDR-274/276). `docs/plan-contracts-and-symbols.md` §3.3 says what a yes returns.", "Falsifying test: a ticket falsified in one run (NEEDS_HUMAN, exit 10), then a second run whose test gate is bound to Go, with a probe that resolves nothing until the approved install runs. Against HEAD the install runs and the run exits 10 with the ticket still NEEDS_HUMAN; fixed, the ticket is requeued and reaches DONE in that same run, exit 0."]
non_goals: ["Does NOT offer leftover escalations in general (D-36). A NEEDS_HUMAN left by an earlier run is still never offered at the start of a run, on a terminal or off one, when nothing is installed; `detent requeue` and `detent approve` remain its answer. This returns only what an install makes worth re-testing.", "Does NOT judge whether a premise was about the toolchain. The session's note is free text, and a rule that parsed it would be a guess dressed as a rule. The operator reads each note in the message and answers once. A premise that is still false after the install is falsified again by the fresh attempt; with the toolchain present, the next run installs nothing and returns nothing, so there is no loop.", "Does NOT split the answer. An operator who wants the install but not the requeue answers no and installs by hand; `detent requeue` and `detent approve` remain for any ticket.", "Does NOT approve. A returned ticket goes through the full loop — implement, gates, review — on whatever work it retained; `HUMAN_APPROVED` stays the operator's plumbing.", "Does NOT cover the plugin driver, for PRDR-276's reason: `/detent:run` drives the referee over MCP, and relaying this answer there is its own change."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-276", "PRDR-112"]
depends_on: ["PRDR-276"]
---

# PRDR-277 — a yes to a toolchain install returns the tickets a false premise stranded

## Where this came from

ksar-cloud's run 7 claimed t-001-bootstrap on a machine with no Go. After 50 turns and $2.74 the
session wrote `falsified.json` — "Environment precondition unmet: there is no Go toolchain on this
machine" — and the referee admitted `PREMISE_FALSIFIED`. The ticket went to NEEDS_HUMAN with its
scaffold committed and retained (`3448866`), and the session's own note ended "TO RESUME: install
Go 1.27+ … then re-queue this ticket". Every one of the other 546 tickets lists t-001 in
`blockers`.

PRDR-276 gave `run` the install. Traced against ksar before relaunching, a run with
`--install-toolchain` installs Go and then draws an empty pool: t-001 is NEEDS_HUMAN, which is not
in the pool, and everything else waits on it. `finish()` exits 10 with t-001 pending. The operator
asked for Detent to install the toolchain and move on, and on this project it cannot move at all
until someone types `detent requeue`.

The operator's decision, verbatim: "I want detent run handle that and move on".

## Why the install's own yes, and why only X-4

PRDR-112 is the precedent. A ticket the outage pushed into NEEDS_HUMAN "is not a human's to
clear": the pool returns it by itself, because the reason is already on the record, and a ticket
a person has touched since is left to that person. V-3's drift sweep returns a drift-blocked
ticket once `verify sync` — a human act — has re-baselined, and records that act as its consent.

A premise falsification is the session saying the ticket, not its code, cannot be done in this
environment. Installing a missing toolchain changes the environment, on a human's answer. That
answer is the consent here, and the message it answers names each ticket, so the yes covers them.

Only X-4's own note qualifies, and only while it is still the last word. A fix ladder that ran
out against `go: command not found` also escalated because of the missing compiler, but its last
word is the ladder's, and a requeue there is a different claim about a different record.

## Falsification against HEAD

`bf256de`, with this ticket's test file copied into a scratch worktree of it. Nine tests fail, each
on the property it names:

```
× … > the stranded ticket is requeued, the same run claims it, and it reaches DONE
  → {"schema_version":1,"exit":10,"pending":[{"id":"t1","state":"NEEDS_HUMAN","reason":"falsified mid-implementation: Environment precondition unmet: there is no Go toolchain on this machine"}]}: expected 10 to be +0
× … > a returned ticket whose premise is still false goes back to its human, once — no loop
  → one fresh attempt, and the yes is spent: expected [] to have a length of 1 but got +0
× … > with no one to ask, nothing is installed, nothing is returned, and the refusal says what a yes returns
  → expected 'missing toolchain: go (brew install g…' to contain 't1'
× … > a ticket unreadable while the question is written is the loop's kernel error, and nothing is installed
  → expected [ 'brew install go' ] to deeply equal []
× what the question says > lists each ticket a yes returns with its premise, after what the yes installs
  → the ticket is named: expected -1 to be greater than 127
× what the question says > an install that resolves hands back exactly the tickets it named, and what it installed
  → expected undefined to deeply equal { ids: [ 't-001-bootstrap' ], …(1) }
× what the question says > nothing to install, nothing to hand back
  → expected undefined to be null
× only what the question named … > a stranded ticket the question did not name is not returned
  → (0 , requeueOnInstall) is not a function
× only what the question named … > a named ticket a person touched after the question was shown is left to that person
  → (0 , requeueOnInstall) is not a function
Tests  9 failed | 3 passed (12)
```

The first line is ksar's relaunch in miniature: the approved install ran, and the run still exited
10 on the one ticket everything waited on. The fourth shows the order HEAD had: it installed first
and met the unreadable ticket later. The three tests that pass on HEAD are guards — a declined
install returns nothing, a ticket a person has touched is left to that person, and with the
toolchain present nothing is asked (D-36) — and cannot fail on a `run` that never returns a ticket.

## What changed

- `src/kernel/referee-sweeps.ts`, the module that holds PRDR-112's sweep:
  - `strandedByPremise` names each NEEDS_HUMAN ticket whose last word is still the kernel's X-4
    note, with the premise in the session's words.
  - `requeueOnInstall` returns the ones the question named, if they are still stranded, through
    `HUMAN_REQUEUE`. The consent is the install; a fresh generation's reason names the install
    and carries the premise; a note says why.
  - `resumeOnce` spends the yes at the pool's first draw and never again.
- `src/kernel/referee.ts`: the pool calls it BEFORE it reads the ready set, where the V-3 drift
  sweep already sat. Placed after the read, as the outage sweep is, the returned ticket missed its
  own draw: the ksar-shaped test exited 0 with t1 READY and unclaimed. That is D-37, below.
- `src/kernel/run-toolchain.ts`: the question lists the tickets a yes returns, and the no-asker
  refusal says so. The outcome hands back `{ids, installed}` only when something was installed.
  The tickets are read only when there is a question to put them in, so a run that installs
  nothing reads no ticket here.
- `src/kernel/run.ts`: passes the tickets in and the resume set on. An unreadable ticket met while
  naming them is the kernel error the loop would have met: exit 1 with the reason (C-11), not a
  throw out of `run`.
- `src/kernel/dependency.ts`: the X-4 note prefix has one definition; `referee-session.ts` writes
  it and the sweep reads it.
- `src/cli/run.ts`: `--install-toolchain` documents the second thing its yes does.
- `detent-prd-v3.md`: X-4⁶, after X-4⁵. `docs/plan-contracts-and-symbols.md` §3.3: what a yes
  returns.

Tests: `tests/kernel/run-toolchain-resume.test.ts` (12). Seven drive two real runs on ksar's shape
— the first leaves `t1` falsified, the second binds the test gate to Go and puts a stand-in `go` on
PATH, so a returned ticket's gate runs the same on any host. Three pin what the question says and
hands back; two pin `requeueOnInstall`'s boundaries: only a named ticket, only while untouched.

## Mutation battery

Fifteen mutants, one per way this could be wrong, each run against the three test files that cover
it (`run-toolchain-resume`, `run-toolchain`, `run`; baseline 51/51 green) and restored from a
snapshot, never from git. Every run used a PATH with Homebrew removed, so no mutant could reach a
real `brew install`.

| Mutant | Result |
|---|---|
| S1 any NEEDS_HUMAN counts as stranded, whatever its last word | KILLED (2) |
| S2 a stranded ticket the question did not name is returned | KILLED (1) |
| S3 a ticket a person touched since is returned | KILLED (1) |
| S4 the recorded consent omits what was installed | KILLED (1) |
| S5 the ticket resumes its old generation instead of a fresh one | KILLED (1) |
| S6 no note says why the ticket came back | KILLED (1) |
| S7 the yes is spent at every draw, not once | KILLED (1) |
| S8 the sweep runs after the ready set is read (the outage sweep's placement) | KILLED (2) |
| S9 tickets are returned when nothing was installed | KILLED (2) |
| S10 the question omits the tickets a yes returns | KILLED (2) |
| S11 the no-asker refusal omits what a yes returns | KILLED (1) |
| S12 the premise is quoted with the kernel's prefix | KILLED (1) |
| S13 an unreadable ticket escapes `run` as a throw | KILLED (1) |
| S14 `run` never hands the resume set to the referee | KILLED (2) |
| S15 `run` names no stranded tickets | KILLED (4) |

15/15 killed. The count is the number of tests that failed.

Two needed a second run, and both are recorded as they happened:

- S5's first anchor matched three lines — the drift and outage sweeps write a ticket the same way —
  so the harness refused to guess. Re-run on a two-line anchor unique to this sweep: killed.
- S7's first run did not finish. With the yes spent at every draw, the "no loop" test — unbounded
  then — returned the re-falsified ticket, which was falsified again and returned again: a worker
  sat at 99.8% CPU for 18 minutes until I killed it, and the harness, reading no totals, printed
  `SURVIVED (PASS ?)`. That was a test unable to fail, not a pass. The test now caps the run at
  three tickets, so this mutant fails on the implement count instead of looping. Re-run: killed.

Seven gates green: 1427 tests across 137 files (2 skipped).

## Recorded, not fixed

- **D-37, the outage sweep's placement.** `RefereeCore.pool()` reads `ready(root)` before
  `requeueOutageVictims` runs, so a PRDR-112 victim returned to READY is missing from that draw.
  When the victims are all that is left, or everything else waits on them, the run exits 0 with
  the work READY and unclaimed. This sweep was built into the same trap and moved out of it; the
  outage sweep is PRDR-112's and is left as it is. Logged in the run tracker.
- **D-36 stands.** With the toolchain present, a leftover escalation is still never offered at the
  start of a run.
