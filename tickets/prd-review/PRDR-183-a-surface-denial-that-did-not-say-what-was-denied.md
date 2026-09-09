---
id: PRDR-183
title: "A refused surface request rendered as `surface DENIED:  ()` — no path, no reason, and three different refusals reading identically"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "found-by-live-run", "observability"]
surface: ["src/kernel/referee-session.ts", "tests/sessions/sdk.test.ts"]
prd_refs: ["SEC-3"]
acceptance_criteria: ["A denial names which rule refused: no path, not a concrete repository path, protected, or the grant budget exhausted.", "A request that carries no path produces a note saying so, rather than rendering as nothing.", "An absent justification is absent, not an empty pair of brackets."]
non_goals: ["Does not change what is granted or refused. The lever's decisions are unchanged; only what it tells the operator is."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-132", "PRDR-149"]
depends_on: []
---

# PRDR-183 — a denial nobody could read

**Severity:** minor · **Category:** defect · **Found by:** a live containment run

## Problem

Observed in a real session, not a test. A ticket's acceptance criterion required `npm test` to
pass, the test script was broken, and the script lives in `package.json` — outside the ticket's
declared surface. The session diagnosed that correctly and asked for a widening. Twice. What the
operator was left with:

```
[kernel] surface DENIED:  (AC 2 requires `npm test` to pass, but the test script itself is broken…)
[kernel] surface DENIED:  () (SEC-3)
```

The message was `surface DENIED: ${target} (${why})`. The request carried no `path`, so the target
rendered as nothing; on the second attempt the justification was empty too, leaving a denial that
names neither what was refused nor why.

Three distinct refusals also read identically — a malformed path, a protected path, and an
exhausted grant budget — so an operator could not tell which rule fired, which is the difference
between "rephrase your request" and "stop asking".

The lever behaved correctly throughout: the request was genuinely inadmissible and SEC-3 refused
it, and the ticket escalated to a human with a dossier. The defect is entirely in what the human
was told.
