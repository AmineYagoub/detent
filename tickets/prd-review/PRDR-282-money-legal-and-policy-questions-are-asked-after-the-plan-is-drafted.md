---
id: PRDR-282
title: "C-3′ asks every question once, at PRESENT, after the whole plan is drafted on assumptions. For a decision counted in money or contracts, every slice resting on it is drafted, reviewed and cached before the founder sees it. DECIDE asks those questions once, early, on a TTY; settles every other gap as a vetoable default; and, off a TTY, takes every recommended answer"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "C-3′", "C-3″", "AWAIT_INFO", "headless"]
surface: ["src/init/decide.ts", "src/init/questions.ts", "src/init/present.ts", "src/init/machine.ts", "src/init/pipeline.ts", "src/schemas/init.ts", "src/cli/init.ts", "src/schemas/roles.ts", "prompts/decide.md", "prompts/manifest.json", "tests/init/decide.test.ts"]
prd_refs: ["C-3′", "C-3″", "C-3‴", "C-5", "C-8", "C-14′", "D-26", "PRDR-119", "PRDR-166", "PRDR-207", "PRDR-278", "PRDR-281"]
acceptance_criteria: ["DECIDE reads AUDIT's checkpoint and sorts every open item. A C-3″ (PRDR-119) question is asked. Everything else is settled as a vetoable default `X-n`, with its value and its reason.", "On a TTY the questions come in screens of at most four. Each lists its recommended option first, and each option states its consequence. The answers are written to `docs/founder-decisions.md` as `D-n` entries with the question, the answer and the reason.", "The stop raises AWAIT_INFO at DECIDE. The interrupt set stays C-5's five, and `INTERRUPT_PHASE` records every phase AWAIT_INFO may be raised at.", "Off a TTY, DECIDE never stops. It takes every recommended answer, logs each as a vetoable `X-n`, and says so in `init`'s output (decision 9).", "A question the decision log already answers is never asked, in any words (C-3‴, PRDR-207).", "An answer changes the decision log, and the next `detent init` replays from DECIDE forward and never re-runs AUDIT (C-8).", "PRESENT lists every `X-n` with C-3′'s assumptions. A veto is an edit to the log: it replays DECIDE forward, and only the slices whose inputs changed are re-planned.", "In greenfield, DECIDE also records the stack, as PRDR-290 specifies, since ANALYZE is folded into it.", "DECIDE's session runs as the `spec_write` role, reading and writing the pack (decision 15), routed to `claude-opus-5-5` at `max` (decision 14). The role joins PRDR-281's `schema_version` event."]
non_goals: ["Does NOT add an interrupt. A sixth would be a new decision class, which C-14′ makes a major-version decision.", "Does NOT ask engineering questions. Anything a competent engineer could settle is settled and recorded (C-3″).", "Does NOT write the pack; WRITE does (PRDR-283)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-117", "PRDR-119", "PRDR-207", "PRDR-281", "PRDR-290"]
depends_on: ["PRDR-278", "PRDR-281"]
---

# PRDR-282 — DECIDE

## Where this came from

The ksarjs founder decisions came after the audit and before any writing: 68 decisions (D1–D66,
D32a and D52a), asked in rounds of at most four with the recommended option first, and 35
vetoable defaults (X1–X35), each recorded in `founder-decisions.md` with its reason. Nothing was
written on a guess about money or law.

## Problem

C-3′ asks every question once, at PRESENT, after the whole plan is drafted on assumptions. That
is right for a question an assumption can carry cheaply. It is wrong for one whose answer is
counted in money or contracts (C-3″, PRDR-119). Every slice resting on that assumption is
drafted, reviewed and cached before the founder sees it, and an overturned answer re-plans every
slice whose inputs it touched (C-8).

## Design

The plan's §6. The stop raises AWAIT_INFO at DECIDE, so the five interrupts stay closed (C-5)
and C-14′'s freeze holds. The answers land in the decision log, where the next `detent init`
reads them (PRDR-166), and the replay starts at DECIDE. Off a TTY, the recommended answers are
taken and logged as vetoable (decision 9). PRESENT then treats them exactly as it treats C-3′'s
assumptions.
