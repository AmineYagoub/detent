---
id: PRDR-083
title: "The spend cap should default, not be demanded at first init"
state: DONE
severity: minor
category: usability
labels: ["prd-review", "user-decision"]
surface: ["src/schemas/budgets.ts", "src/init/config.ts", "src/cli/init.ts"]
prd_refs: ["X-1", "P6", "D-25", "C-4"]
acceptance_criteria:
  - "`run_spend_usd` carries a default like every other X-1 ceiling; a budgets object omitting it loads."
  - "A first `detent init` with no `--spend-cap-usd` writes the default and ANNOUNCES the figure and how to change it."
  - "The flag still sets the figure on a first init; an existing config is still never rewritten."
  - "The ceiling's behaviour is untouched: still a launch gate, still bounded overshoot (D-25), still routes to a human (P6)."
non_goals:
  - "Does not remove the ceiling: an unbounded run has no runaway stop, and P6's 'every counter has a ceiling' is not up for negotiation."
  - "Does not make the figure auth-aware; a subscription estimate and an API-key bill share one ceiling until evidence says they should not."
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-043", "PRDR-052"]
depends_on: []
---

# PRDR-083 — the spend cap should default, not be demanded at first init

**Severity:** minor · **Category:** usability · **Found by:** the user, after setting
$500 by hand on a first init and observing the decision bought nothing.

## Problem

X-1 gave `run_spend_usd` no default on the reasoning that no universal figure is
defensible, so `init` refused a first run without `--spend-cap-usd`. Every other
ceiling in the table defaults; this one alone was a required upfront decision.

The reasoning does not survive contact with how the figure is actually produced.
PRDR-052 settled that cost is a **client-side estimate** — on subscription auth
(the documented path since 3.0-12) nothing is billed per run at all; the number
tracks quota consumption, not money owed. So the first init of every project
demanded a dollar decision that (a) the user cannot calibrate before seeing a
single ticket run, and (b) does not correspond to a charge. It bought friction,
not protection — the protection is the ceiling existing, not the human choosing
its value in advance.

## Resolution

`run_spend_usd` joins the rest of X-1 with a default of **$100** — above the
largest validated run (the ~$50–60 self-build) with headroom, low enough to stop a
runaway within noticing distance. A first `init` without the flag writes it and
says so, naming the figure and how to change it; with the flag, the flag wins.
Everything downstream is unchanged: still a launch gate with D-25's one-session
overshoot bound, still cumulative across restarts, still routes to a human on
breach (P6). What is deleted is the demand, not the ceiling.
