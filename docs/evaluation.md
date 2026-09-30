# Evaluating a cheaper model or effort level

Detent routes every role to a model and an effort level. A lower level or a
cheaper model would cut what `init` costs. D-35 allows that only after the new
setup passes a bar on real evidence (N-8), and S-5⁷ moves a task's routing
only on a passing result. This page shows how to build the evidence, run a
setup on it, and read the result.

The evidence comes from a real run, so it is a project's own text: its
documents, its claims and what its reviewers found. It is always kept outside
this repository, in a directory you choose. This repository holds only the
code that builds the sets, runs an evaluation and scores it.

## The two sets

**The claims set.** Arm A of PRDR-317's A/B test checked each of a project's
claims in a session of its own. The set holds:

- every claim arm A found wrong;
- a sample of the claims it confirmed, 30 by default. They are the first in the
  order of their hashes, an order nobody chose.

Each claim keeps its wording from the survey and the brief AUDIT committed for
it. The set's tree is the project as the survey read it: the copy's last
commit, since WRITE rewrites the documents only after AUDIT. The builder
refuses the set in two cases:

- a committed verdict disagrees with arm A's own artifact;
- the commit does not hold a claim's passage.

**The reviews set.** VALIDATE keeps each first-round review under a key. The
key digests everything the reviewer was given and the contents of every file it
read. The builder works out each area's round-1 task from the copy's files with
VALIDATE's own code. It accepts a kept review only when that task gives the
same key, which proves the files are exactly what the reviewer read. The set
holds the areas whose proven review has a blocker, with each area's task and
blockers. Its tree is the pack as the reviewers read it.

Build both from the copy a run left behind. The builder only reads that copy:

```bash
npx tsx scripts/eval-build.ts --from ~/tabachir-detent-test --out ~/detent-evals/tabachir
```

This writes `claims/` and `reviews/` under `--out`. Each holds `set.json` and
`tree/`. A set is built once. A directory that already exists is refused, and
so is any directory inside this repository or inside the copy.

## Running an evaluation

An evaluation runs a set on one model and effort level:

- For the claims set, it checks every claim the way AUDIT does, through
  `checkOneClaim` with AUDIT's inputs.
- For the reviews set, it reviews every area the way VALIDATE's first round
  does, through `reviewArea` on the task the kept review was given.

The sessions use the same backend, prompts and session setup as `init`. Only
the evaluated role's routing changes.

```bash
npx tsx scripts/eval-run.ts --set ~/detent-evals/tabachir/claims --copy ~/tabachir-detent-ab2 \
  --model claude-opus-5-5 --effort high --budget-usd 150
```

It runs real sessions and spends real money. Guards:

- **The copy.** It runs only on a disposable copy you name. It refuses:
  - the copy the set was read from;
  - any worktree of that copy's repository;
  - this repository;
  - a copy another process holds.
- **The copy's files.** They must be exactly the set's tree, so the sessions
  read what the original sessions read. If they differ, `--stage` commits the
  set's tree to the branch `detent-eval/claims` or `detent-eval/reviews`. Every
  earlier commit stays as it was. A copy with uncommitted changes outside
  `.detent/` is never staged.
- **The budget.** It needs `--budget-usd`. Before starting, it says how many
  sessions it will run and what they should cost. It uses Detent's measured
  figure for the route or, for a route nothing has measured, the most expensive
  measured figure of that kind. It will not start a session if that session's
  figure would take the spend past the budget; the units after it are left
  unfinished. This is stricter than `run`'s caps, which only announce: an
  evaluation is money you approved in advance, and nothing is lost by
  stopping it.
- **Concurrency and records.** It runs four sessions at once (`--at-once`),
  holds the copy's run lock, and records every session in the copy's ledger.
- **Earlier answers.** AUDIT checks only a claim with no committed brief, and
  a first-round reviewer never finds a kept review of its own area. So no
  session of theirs can read the answer it is asked for. A copy holds such
  answers, left by the run it was cloned with or by an earlier evaluation.
  Before any session starts, the evaluation removes each one from the copy's
  `.detent/` and names them:
  - for the claims set: the committed briefs of the set's claims, every check
    session's artifact, AUDIT's checkpoint and the init journal, whose
    entries end with each session's last words;
  - for the reviews set: the kept reviews and the round's state, every
    reviewer's artifact, VALIDATE's checkpoint and the journal.

  Other claims' briefs stay. The results keep the brief each check committed.

It writes its results beside the set, under `results/`, and prints the score.

## The bar, and reading the score

A setup **passes** when:

- it finds every claim arm A found wrong to be wrong;
- it calls none of the confirmed claims wrong, unless a person settles that
  arm A was the one mistaken;
- it reports every blocker at its place: the same file, with a quote that
  overlaps the blocker's, as a blocker or a major. A blocker reported as a
  minor is a miss, since a round with no blocker and no major ends VALIDATE.

The score prints PASS, FAIL, PENDING or INCOMPLETE:

- **FAIL** lists each miss.
- **PENDING** means the setup called some confirmed claims wrong. The score
  lists each one with its source and correction for a person to settle.
- **INCOMPLETE** means a unit did not finish, because of the budget or a failed
  session. An incomplete evaluation never passes.

Every score ends with the spend, the session count and the wall clock.

To settle the pending claims, write a JSON file that maps each claim's hash to
`arm_a_mistaken` or `arm_mistaken`, then score again. This launches nothing:

```bash
npx tsx scripts/eval-score.ts --results ~/detent-evals/tabachir/results/<file>.json --settled settled.json
```

The scripts exit 0 on a pass, 1 on a fail, 3 when the result is pending or
incomplete, and 2 when they refuse.

## Runs differ

A model finds different things on different runs. PRDR-317's two arms
disagreed on 15 of the 107 claims both checked. So re-run today's setup on the
same sets before judging a cheaper one. If today's setup misses part of the
bar on a second run, you decide the bar, and no routing moves until then.

The question for the re-run is whether a second run finds the same wrong
claims. So `--only wrong` checks only the claims arm A found wrong, and the
score counts only those:

```bash
npx tsx scripts/eval-run.ts --set ~/detent-evals/tabachir/claims --copy ~/tabachir-detent-ab \
  --model claude-opus-5-5 --effort max --budget-usd 60 --only wrong
```
