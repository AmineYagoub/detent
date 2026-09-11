---
id: PRDR-224
title: "The fix roles receive the surface-request and falsification seams and are not told their shapes: review-fix wrote `requested_paths` twice and was refused twice for naming no path"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "prompts", "SEC-3", "X-4", "review-fix", "gate-313"]
surface: ["prompts/blind_fix.md", "prompts/review_fix.md", "prompts/informed_fix.md", "prompts/manifest.json", "tests/sessions/prompts.test.ts", "detent-prd-v3.md"]
prd_refs: ["SEC-3", "X-4", "S-7", "V-6", "N-6", "PRDR-073", "PRDR-212"]
acceptance_criteria: ["The three fix-role prompts state the two signal shapes the implementer is told (PRDR-073, PRDR-212): a surface expansion is `{\"path\": \"<one file or glob>\", \"justification\": \"<one line>\"}` at the `surface_request_out` path in the inputs, ruled on after the session; a premise that cannot be met as specified is `{\"note\": \"<why>\"}` at `falsified_out` (X-4), and a protected path is never grantable, so a criterion that needs one is a falsification, not a request. Observed FIRST (V-6): `blind_fix.md` and `review_fix.md` carry neither shape, `informed_fix.md` carries the request but not the signal; gate-313's t-s01-004 review-fix sessions wrote `{\"requested_paths\": [\".detent/bindings.json\"], \"reason\": …}` twice and the kernel noted `surface DENIED: the request named no path (SEC-3)` twice, then spent a third round the same way.", "`prompts:check` hash updated; the prompt-marker test requires both shapes in all three fix roles."]
non_goals: ["Does not change what is grantable: SEC-3's protected floor stands, and `.detent/bindings.json` stays immutable to sessions.", "Does not touch the reviewer."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-073", "PRDR-212"]
depends_on: []
---

# PRDR-224 — a seam without its shape

**Severity:** minor · **Category:** defect · **Found by:** gate-313, take 6 — t-s01-004's three
review-fix rounds

## Problem

Every write-role session is handed `surface_request_out` and `falsified_out` in its inputs.
PRDR-073 documented the request's shape in `implement.md`; PRDR-212 documented the
falsification's there too. The three fix roles were left with the seams and no shapes.

t-s01-004's acceptance criterion asks for a test against the repository's own
`.detent/bindings.json` — a path SEC-3's structural floor makes immutable to sessions, so the
criterion cannot be met as specified and X-4 is the honest answer. The review-fix sessions
instead tried to widen the surface, guessed a shape, and were refused for the guess:

```
{"schema_version": 1, "ticket": "t-s01-004", "requested_paths": [".detent/bindings.json"], "reason": …}
→ surface DENIED: the request named no path (SEC-3)
```

Twice, in two rounds, then a third round; `review_fix_attempts` ran out and the ticket went
to a human over a file no request could have been granted for.

## The shape

One sentence in each fix role, pointing at the two shapes the implementer already has, and
saying the one thing that would have ended this in round one: a protected path is not a
request, it is a falsification.

## What implementation changed

**One sentence in three prompts.** `blind_fix.md`, `informed_fix.md` and `review_fix.md` now
carry, after the symbol sentence: *"Two signals share the implementer's shapes: a surface
expansion is `{"path": "<one file or glob>", "justification": "<one line>"}` written to the
`surface_request_out` path in your inputs and ruled on after you end; a criterion that cannot
be met as specified is `{"note": "<why>"}` at `falsified_out` (X-4) — and a protected path is
never grantable, so a criterion that needs one is a falsification, not a request."* Manifest
re-hashed; the prompt-marker test requires `justification` and `falsified_out` in all three.

**V-6, in order.** Observed on the tree as it was: the three marker tests failed on the missing
shapes; on gate-313, t-s01-004's review-fix sessions wrote `requested_paths` twice and were
refused twice for naming no path. Then the change; then green. The prompt files landed in the
same commit as PRDR-223's, which rewrote the neighbouring sentence.

