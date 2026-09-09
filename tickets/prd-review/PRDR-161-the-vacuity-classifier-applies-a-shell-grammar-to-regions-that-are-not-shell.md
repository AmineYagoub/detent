---
id: PRDR-161
title: "The vacuity classifier applies a shell grammar to config_region shapes that are not commands, and falsely accuses every gate of an ordinary Python project"
state: DONE
severity: critical
category: defect
labels: ["prd-review", "found-by-audit", "false-accusation"]
surface: ["src/adapter/bind.ts", "detent-prd-v3.md"]
prd_refs: ["V-1‴"]
acceptance_criteria: ["Only a `config_region` that actually carries an executable command body is classified. Which adapters those are is a whitelist keyed on `candidate.adapter`, not a guess made by sniffing the region's text.", "A `pyproject.toml` whose `[tool.*]` tables hold only comments produces no notice for `pytest`, `ruff`, `mypy` or `python -m build`, proven end-to-end through the real `discover()` and `bindAll()`.", "Every true positive V-1‴ names is preserved."]
non_goals: ["Does not extend the classifier to understand TOML. A region that is not a command is not this check's business."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-156", "PRDR-155"]
depends_on: []
---

# PRDR-161 — the harm the redesign was chosen to avoid, committed by the redesign

**Severity:** critical · **Category:** defect · **Found by:** the audit of `bdafdb5`

## Problem

`commandBody` enumerates three region shapes: `exists:` (no body), `scripts.<name>=` (script body),
and "anything multi-line is a make or just recipe whose first line is the target header". There are
**seven** adapters, and two more shapes:

- `src/adapter/discover/python.ts:55` — `config_region: table.block`, a **TOML table**.
- `src/adapter/workspace.ts:129` — `workspace:<kind>:<marker>`, a marker string.

A TOML table is handed to a shell-statement classifier. Its header line is stripped as if it were a
make target, the remaining lines are split on `&&`/`;`/newline, comment lines are filtered out — and
a table whose body is entirely comments leaves zero statements, which `verifiesNothing` reports as
vacuous. Probed end-to-end through the real `discover()`:

```
test   pyproject  "pytest"          VACUOUS=true   region="[tool.pytest.ini_options]\n# configuration lives in pytest.ini …"
lint   pyproject  "ruff check ."    VACUOUS=true   region="[tool.ruff]\n# see ruff.toml"
build  pyproject  "python -m build" VACUOUS=false  region="[build-system]\nrequires = [\"setuptools\"]"
```

`pytest` and `ruff check .` are real gates, told they exit 0 having done nothing, with a TOML
comment quoted back as "the command".

The docstring at `src/adapter/bind.ts` says "a false accusation on every gate would be a new harm",
and the PRD amendment states as fact that `config_region` "already carries the script body or
recipe block the engine read". That is true for three adapters of seven. The classifier's silence
on the other four is accidental — `requires = ["setuptools"]` simply happens not to match `NO_OP`.

This is the same shape as PRDR-149's `isConcreteRepoPath`: a rule written as a blacklist of the
forms someone thought of, where the correct form is a whitelist of the ones actually known.
