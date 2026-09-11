---
id: PRDR-223
title: "The symbol server exposes twenty-one tools the session may not call, its descriptions steer the model to them ahead of the prompt, and one of the four Detent grants does not exist — the server should expose exactly what is granted"
state: DONE
severity: major
category: defect
labels: ["prd-review", "symbols", "S-3′", "serena", "gate-313", "measurement"]
surface: ["src/adapter/symbols.ts", "src/kernel/referee-context.ts", "tests/sessions/symbols.test.ts", "tests/kernel/session-policy.test.ts", "prompts/implement.md", "prompts/review.md", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/review_fix.md", "prompts/diagnose.md", "prompts/research.md", "prompts/manifest.json", "agents/implement.md", "agents/review.md", "agents/diagnose.md", "agents/research.md", "hooks/dist/detent-hook.cjs", "detent-prd-v3.md"]
prd_refs: ["S-3′", "S-3‴", "S-3⁷", "S-3⁷′", "D-4", "V-6", "N-6", "PRDR-198", "PRDR-221", "PRDR-222"]
acceptance_criteria: ["Serena is launched with a Detent-written CONTEXT (`--context <file>`, a path Serena accepts) whose `excluded_tools` names every tool of the pinned version except the granted symbolic reads, so the MCP surface a session sees is exactly what the allowlist admits. The file is written under the root's local state at launch, never committed, and its content is a constant checked against `serena tools list` where the tool is installed. Observed FIRST (V-6): gate-313's take-7 first session, carrying PRDR-222's sentence, still opened with `check_onboarding_performed` — refused — because Serena's own description of that tool says to call it first; three take-6 sessions did the same with `list_dir` and `think_about_task_adherence`.", "`SYMBOL_READ_TOOLS` names tools the pinned Serena HAS: `find_implementations` is not among 0.1.4's twenty-four tools (`serena tools list`), so the allowlist and `symbol_tools` named a phantom. The set is `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`, and the test reads the tool's list where installed.", "The prompt sentence of S-3⁷′ shrinks to the truth that remains: the listed tools are the server's whole surface for this session.", "Measured on the next take: refused Serena calls per session, expected zero, and granted calls, expected more than zero."]
non_goals: ["Does not grant reading, listing, searching, memory or editing through Serena: the session's own tools read and search, memory is cross-session state Detent does not control (C-8, S-6), and editing bypasses containment (S-3′).", "Does not edit anything under `~/.serena`: the context is Detent's own file, passed per launch (D-4)."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-221", "PRDR-222", "PRDR-198"]
depends_on: ["PRDR-222"]
---

# PRDR-223 — a surface that says one thing and shows another

**Severity:** major · **Category:** defect · **Found by:** gate-313, take 7, the first session
launched with PRDR-222's sentence

## Problem

PRDR-221 put the server's tools on the turn-one list; PRDR-222 told the session which four are
granted and that the rest are refused. The first session launched with that sentence opened
with `check_onboarding_performed` anyway, refused, exactly as the three take-6 sessions before
it. The reason is on the tool list: Serena describes that tool as the one to call before
beginning work, and a model weighs the description beside the tool above a sentence in a prompt
it read earlier. Twenty-one of the twenty-four tools on the list are ones Detent refuses. The
`--context ide-assistant` Detent passes excludes five; the remaining excluded set was never
Detent's to choose — until now, because Serena's `--context` also accepts a path to a custom
context YAML, and a context's `excluded_tools` removes tools from the MCP surface itself.

And one of the four grants is a phantom. `SYMBOL_READ_TOOLS` names `find_implementations`;
`serena tools list` for the pinned 0.1.4 does not. It has been allowlisted since PRDR-121 and
named to sessions since PRDR-221, and a call to it would fail as an unknown tool. PRDR-198
verified the context and mode values against the tool and did not reach the tool names.

## The shape

Expose exactly what is granted. Detent writes its own context file — every tool excluded but
`find_symbol`, `find_referencing_symbols` and `get_symbols_overview`, with a two-line prompt
saying how to use them — under the root's local state and passes it as `--context`. The
phantom leaves the read set. The S-3⁷′ sentence shrinks to what is left true. Then the counts.

## What implementation changed

**Detent's own context.** `SERENA_TOOLS` in `src/adapter/symbols.ts` is the pinned 0.1.4's whole
loaded inventory (36 names, from its startup log); `SYMBOL_CONTEXT_YAML` is a Serena context in
Serena's own shape — description, a two-line prompt, `excluded_tools` = the inventory minus the
read set, empty overrides. `writeSymbolContext(root)` writes it to `.detent/state/serena-context.yml`
(F-1 local, never committed) and the referee context does so before every launch;
`symbolServerConfig` passes `--context <that file>` in place of `ide-assistant`. Observed live
on a probe: *excluded 21 tools … Number of exposed tools: 3 … Active tools (3):
find_referencing_symbols, find_symbol, get_symbols_overview*.

**Three, not four.** `SYMBOL_READ_TOOLS` drops `find_implementations`; the allowlist, the
`symbol_tools` input and the excluded list follow from it. The inventory test reads
`serena tools list` where the tool is installed and requires every name outside the read set to
be excluded and every read tool to exist.

**The sentence that stays true.** S-3⁷′'s sentence in the seven role prompts is now *"The
tools listed there are the server's whole surface for this session; nothing else of Serena's is
available."* Manifest re-hashed, agents and bundle regenerated.

**V-6, in order.** Observed on the tree as it was: the read set had four names; the launch passed
`ide-assistant` and wrote no file; the inventory test found no `SYMBOL_CONTEXT_YAML`; the launch
test expected four `symbol_tools`; seven prompt markers failed. Then the change; then green.


## Audit

Cold re-read, then a second live start with the PRODUCTION file rather than the hand-written
probe: `writeSymbolContext` on a scratch root wrote 33 exclusions (the 36-name inventory minus
three); Serena reported *excluded 21 tools* — the other twelve are optional tools it never
activates — and *Number of exposed tools: 3 … Active tools (3): find_referencing_symbols,
find_symbol, get_symbols_overview*, no errors. The adapter's long comment still presented
`ide-assistant` as the answer and the memory tools as exposed; both are now history, and the
comment says so, including the one thing the context does NOT give — a guarantee about
remembering — and the one thing it cannot cover: tools a Serena newer than the pin might add,
which the allowlist still refuses and the inventory test still flags. No behaviour change.
