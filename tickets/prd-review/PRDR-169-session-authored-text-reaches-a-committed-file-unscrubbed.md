---
id: PRDR-169
title: "scrub() never reaches session-authored text, which lands verbatim in .detent/plan/<id>.json — a committed file"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "security"]
surface: ["src/kernel/tickets/mutations.ts", "src/kernel/referee-session.ts"]
prd_refs: ["SEC-4", "F-1"]
acceptance_criteria: ["Text a SESSION authored — its final message, its model-fallback reason, and the free-text fields of the `oversized.json`/`falsified.json` signals it writes itself — is redacted before it can reach a ticket note or a journal event.", "The redaction happens at the persistence seam, not only at each of today's call sites, so the next site that appends session text inherits it rather than having to remember."]
non_goals: ["Does not scrub prompts or session inputs. This is about what comes BACK.", "Does not claim `scrub` is complete. It is a pattern list; the point is that it is applied at all on this path."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-133", "PRDR-156"]
depends_on: []
---

# PRDR-169 — SEC-4's redactor, applied to gate output and nothing else

**Severity:** critical · **Category:** defect · **Found by:** the full-project audit of `0752fef`

## Problem

`scrub()` exists for SEC-4 and its one direct production call site is `referee-gate.ts`, whose
comment reads "scrubbed BEFORE write — a secret echoed by a failing gate". Nothing scrubbed what
the SESSION itself produces:

- `SessionResult.rawTail` — the model's own final message — sliced into a note on a crashed
  backend refusal;
- `result.modelFallback.reason`;
- `oversized.json`'s `note` and `falsified.json`'s `note` — free text the session writes itself,
  as its X-4 signal to the referee.

All four flow through `appendNote` → `writeTicket` → `.detent/plan/<id>.json`, which
`fs/layout.ts` marks `tracking: "committed"` — explicitly not gitignored, unlike the ledger,
journal and runs directories. In the default non-worktree mode `finalizeDone` runs `git add -A` in
the root, so this is one ordinary DONE transition from the operator's real git history.

The reachability bar is low and needs no attacker: an honest diagnose session writing "I could not
proceed — auth.ts hardcodes `sk-ant-api03-…`" into its falsification note is sufficient.

## Fix

At the seam. `appendNote` is the one door into a ticket's notes, and the lesson this audit chain
has taught four times is that a rule applied at today's N call sites is forgotten at N+1. The
session-derived values are also scrubbed where they are extracted, so the journal — local, but
still a record — gets the same treatment.
