# Release checklist (C-14′, D-16)

Every version bump and every pinned-backend upgrade (S-5) walks this list —
in order, no skips. The porcelain freeze and the N-7 gate are the two items
this file exists to make unskippable.

1. **Gates green on both Node lines.** `npm run parity:check`,
   `npm run prompts:check`, `npm run lint`, `npm run typecheck`, `npm test` —
   locally and in CI (node 22 + 24).
2. **Porcelain freeze re-affirmed (C-14′).** Exactly two commands and the
   five closed decisions, on both surfaces — CLI and plugin. The golden-path
   docs tests are the proof; a failure here is a major-version decision that
   belongs in the PRD first (N-6), never a test edit.
3. **Plugin validates strictly.** `npm run plugin:validate` — marketplace
   manifest, plugin manifest, `skills/`, `agents/`, all under `--strict`.
4. **Local install smoke.** `claude plugin marketplace add <repo-or-path>` →
   `claude plugin install detent@detent` → both skills present, referee
   server `plugin:detent:referee` connects from a configured project → then
   uninstall. (First executed live at T-124; re-run per release.)
5. **N-7 self-build green (D-16) — the permanent gate.** Dispatch the
   `self-build` workflow with a spend cap: `detent init && detent run` on a
   folder containing only `detent-prd-v3.md` must reach DONE on the walking
   skeleton. Credentials: `ANTHROPIC_API_KEY` or, on a subscription plan,
   `CLAUDE_CODE_OAUTH_TOKEN` minted with `claude setup-token` — either as a
   repo secret. Locally, a logged-in claude CLI suffices.
   No green, no release — every version bump and every S-5 backend upgrade
   re-runs it.
6. **Version pins coherent (SEC-2/S-5).** `plugin.json` version equals
   `REFEREE_VERSION`; `pinned.agent_sdk` equals package.json's exact
   dependency; the backend pin is deliberate.
7. **Security fixtures green (SEC).** The hostile-repo fixture
   (`tests/plugin/hostile.test.ts`) and the sec suite pass; the SEC-6
   platform-merge behavior re-verified live on the current CLI.
8. **Schema discipline (F-3).** Any persisted-shape change this release
   bumped `schema_version` with a migration — never silently.
