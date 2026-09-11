---
id: PRDR-222
title: "Serena's own tool descriptions steer a session to its onboarding, memory and listing tools, which the allowlist refuses — the prompt must say which four are granted"
state: DONE
severity: minor
category: defect
labels: ["prd-review", "symbols", "S-3′", "prompts", "gate-313", "measurement"]
surface: ["prompts/implement.md", "prompts/review.md", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/review_fix.md", "prompts/diagnose.md", "prompts/research.md", "prompts/manifest.json", "agents/implement.md", "agents/review.md", "agents/diagnose.md", "agents/research.md", "tests/sessions/prompts.test.ts", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3⁷", "S-7", "V-6", "N-6", "PRDR-221"]
acceptance_criteria: ["Every role prompt that receives the symbol server says that ONLY the tools listed in `symbol_tools` are granted and that the server's other tools — onboarding, memories, directory listing, editing — are refused and must not be called. Observed FIRST (V-6) on gate-313's first session after PRDR-221: with the eighteen Serena tools on the turn-one list, the model's first two Serena calls were `check_onboarding_performed` and `list_dir`, both refused by the allowlist (\"you haven't granted it yet\") — two turns spent on tools Serena's own descriptions recommend first.", "`prompts:check` hash updated; `agents/*.md` regenerated; the prompt-marker test requires the sentence in every role that receives the server.", "Nothing else changes: the same four tools are granted, the same refusals stand (S-3′)."]
non_goals: ["Does not grant the onboarding, memory or listing tools: memory is cross-session state Detent does not control (C-8, S-6), and listing and reading are the session's own tools' job.", "Does not filter what the server exposes — the SDK's stdio config has no per-tool policy (PRDR-221's audit)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-221"]
depends_on: ["PRDR-221"]
---

# PRDR-222 — a server that recommends what it may not do

**Severity:** minor · **Category:** defect · **Found by:** gate-313, take 6, session one, seventeen
tool calls in

## Problem

PRDR-221 put Serena's tools on the turn-one list and told the session what the four read tools
are for. All eighteen of the server's tools are on that list — the stdio config has no per-tool
policy — each with Serena's own description, and those descriptions recommend a workflow:
check whether onboarding was performed, read the memories, list the directory. The session did
what it was told by the nearest text:

> mcp__serena__check_onboarding_performed → Claude requested permissions to use
> mcp__serena__check_onboarding_performed, but you haven't granted it yet.
> mcp__serena__list_dir → … but you haven't granted it yet.

Two refusals, two turns, before the first granted tool. Containment worked; the prompt had not
said where the boundary was. Sessions are fresh (P1), so this repeats per session.

## The shape

One more sentence where PRDR-221's sits: only the listed tools are granted; the server's other
tools — onboarding, memories, directory listing, editing — are refused, so do not call them.

## What implementation changed

**One sentence, seven prompts.** After the S-3⁷ sentence in each role that receives the server
(implement, blind_fix, informed_fix, review_fix, review, diagnose, research): *"Only the tools
listed there are granted; the server's other tools — onboarding, memories, directory listing,
editing — are refused, so do not call them."* Manifest re-hashed; agents regenerated.

**V-6, in order.** Observed on the tree as it was: seven prompt-marker tests failed on the
missing sentence; on gate-313 the first post-S-3⁷ session spent its first two Serena calls on
`check_onboarding_performed` and `list_dir`, both refused. Then the change; then green. The
next take of the gate is the measurement: refused Serena calls per session, expected zero.


## Audit

Cold re-read of the sentence against Serena's full tool list as the session sees it. The
enumeration named onboarding, memories, directory listing and editing; the server also exposes
`find_file` and `search_for_pattern` — file search, the very shape a session reaches for next
when told not to grep — and three `think_about_*` tools. The generic clause already refused
them, but the enumeration is what a model reads, so file search and thinking join it. Marker
unchanged, manifest re-hashed, agents regenerated. The measurement stands as stated: refused
Serena calls per session on the next take, expected zero.
