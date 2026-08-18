# Attributions

## Role prompts (`prompts/*.md`)

The eight vendored role definitions are **adapted from this project's own Python
reference implementation** (Foreman v0.1.3, the porting oracle named in the PRD),
whose prompt set covered seven roles; they were rewritten and extended for the
Detent PRD's protocols — A-2/A-3/A-4/A-5 artifact shapes, the X-6a source
hierarchy, D-6's review/research split, D-13's closed ladder, and the falsified
and surface-expansion signals. Same repository lineage and ownership; no
third-party text is included.

D-9 names the VoltAgent subagent catalog as a curation source to evaluate per
release. **No VoltAgent content is vendored in this release**: the catalog was
reviewed for structure only, and this file must record source and license for
any future release that adapts from it.

## Runtime dependencies

- `@anthropic-ai/claude-agent-sdk` — Anthropic, commercial license per package.
- `zod` — MIT © Colin McDonnell.
- `picomatch` — MIT © Jon Schlinkert.
