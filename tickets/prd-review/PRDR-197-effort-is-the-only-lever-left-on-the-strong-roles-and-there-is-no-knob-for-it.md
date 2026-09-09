---
id: PRDR-197
title: "`model_routing` routes each role to a model but not to an effort, and effort is the only lever left on roles already at the strongest model"
state: DONE
severity: minor
category: gap
labels: ["prd-review", "found-by-audit", "cost", "operator-surface"]
surface: ["src/schemas/config.ts", "src/schemas/roles.ts", "src/sessions/sdk.ts", "src/kernel/worstcase.ts", "tests/sessions/sdk.test.ts", "detent-prd-v3.md"]
prd_refs: ["PRDR-114", "S-5″", "D-22", "PRDR-196"]
acceptance_criteria: ["Effort is configurable per ROLE, beside `model_routing`, over the SDK's closed set (`low`|`medium`|`high`|`xhigh`|`max`).", "The default changes nothing: with no effort configured, a session's options are byte-identical to today's. This ticket ships a knob, not a behaviour change.", "An unknown effort level is refused at config load, naming the key — the discipline PRDR-142 established for `model_routing`, which accepted any key so a typo routed a role to the runtime default forever.", "An effort a routed model cannot serve is DEFERRED, not silently claimed. AMENDED on implementation — see below; the downgrade is silent today and the ticket says so rather than implying otherwise.", "Whatever the config says reaches `buildOptions`. Asserted on the options a session is ACTUALLY built with — SEC-4′ and this line's repeated history are what that sentence is for."]
non_goals: ["Does NOT choose a value. PRDR-196's criterion 3 — measuring finding identity — must land first, or any tuning is against a metric that ticket proves uninterpretable.", "Does not expose `thinking`. Adaptive is the right default for the models Detent routes to, and a second knob over the same behaviour is a way to make them disagree.", "Does not loosen `settingSources: []`. D-22 keeps a repository's own settings file out of a session; the knob belongs in `.detent/config.json`, which is Detent's."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-114", "PRDR-142", "PRDR-196"]
depends_on: []
---

# PRDR-197 — the knob that does not exist

**Severity:** minor · **Category:** gap · **Found by:** asking what could be tuned after
PRDR-196, and finding there was nothing to turn

## Problem

`buildOptions` in [`sdk.ts`](../../src/sessions/sdk.ts) passes `cwd`, `settingSources`, `env`,
`permissionMode`, `allowedTools`, `mcpServers`, `maxTurns`, `model` and `hooks`. Neither
`effort` nor `thinking` appears anywhere in `src/`. So every session — planner, review,
implement, diagnose — runs at the pinned SDK's defaults, which its own types document as
`effort: 'high'` and `thinking: { type: 'adaptive' }`.

It cannot be overridden from outside either: `settingSources: []` (D-22/PRDR-051) means no
user, project or local settings file contributes anything to a Detent session. That isolation
is correct and is not in question here. The consequence is that **effort is unconfigurable, by
construction, with no key anywhere.**

## Why it matters now

PRDR-114 gave every role a model. The judgement roles — `planner`, `review`, `diagnose`,
`informed_fix` — are already on the strongest model available, so **there is no model headroom
left on exactly the roles PRDR-196 identifies as the bottleneck.** Effort is the only remaining
lever, and it is the one that does not exist.

PRDR-196's evidence points at one specific experiment: more effort on the CRITIC, not the
reviser, because the survey it cites names feedback generation as the bottleneck. That
experiment cannot be run today, and this ticket is the reason it will be runnable later — not
the reason to run it now.

## Two failure modes this line has already paid for

- **A key nobody validates.** `model_routing` accepted any key, so a typo routed that role to
  the runtime default forever (PRDR-142). An effort field must not repeat it.
- **A control nothing calls.** `buildSessionEnv` was written, tested and green with no
  production caller, so every session carried the operator's credentials (PRDR-133/SEC-4′); the
  breaker ceilings of PRDR-191 never reached either `SpendLedger`; PRDR-194's first cut reached
  the phases and not the slices. The acceptance criterion is therefore about the options a
  session is BUILT with, not about a function that computes them.

## Amendment on implementation (2026-09-09): the downgrade stays silent, and is recorded as such

Criterion 4 asked for an unservable effort to be handled the way PRDR-114 handles an unservable
model — noted per session. It is not implemented, and pretending otherwise would be the defect
this repository keeps finding.

The capability data exists: `ModelInfo.supportsEffort` and `availableEffortLevels`, reachable
through `supportedModels()`. But that method lives on a LIVE QUERY object, so answering "can
this model serve `xhigh`" costs a session — which makes it a `doctor` probe, not a config-load
check, and a different change from this one.

PRDR-114's mechanism does not transfer either. An unservable MODEL surfaces as a refusal the
backend returns, so the code can see it happen. A downgraded EFFORT is served normally and
reported only in the per-tool-use hook input (`effort.active`, "after any silent downgrade for
the selected model"), so seeing it means threading telemetry out of the containment hook — a
security-critical path this ticket has no business widening.

So: a configured effort a model cannot serve is silently downgraded, the operator can see what
they ASKED for in `.detent/config.json` and cannot see what they GOT, and that is the state of
things until a `doctor` probe or hook telemetry lands. Written down because the alternative —
shipping the knob and leaving the criterion looking satisfied — is exactly how PRDR-198's memory
claim survived two rewrites.

## Scope

A knob and a default that changes nothing. Landing it should be observable only as a new
config key and a test; the day it changes a session's behaviour is the day someone sets it
deliberately, against a measurement PRDR-196 has to provide first.
