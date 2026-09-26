---
id: founder-decisions
title: Founder decisions — Toolshed
---

# Founder decisions

Decided on 26 September 2026. Where a decision here conflicts with a PRD, this record wins.

## Decisions

### Scope

| Id | Question | Answer | Reason |
|---|---|---|---|
| D-1 | Who may borrow? | **Members only, after an identity check** | Tools are expensive and the library is small. |
| D-2 | How long is a loan? | **Seven days, extendable once** | Most jobs finish in a weekend. |

### Money

| Id | Question | Answer | Reason |
|---|---|---|---|
| D-3 | Is there a deposit? | **Yes, refunded in full on a timely return** | It is the only lever against loss. |
| D-4 | Which payment rail? | **Card through one provider** | Members pay by card already. |

### Amendment

| Id | Question | Answer | Reason |
|---|---|---|---|
| D-5 | Amends D-2 | **A loan cannot be extended while a reservation waits** | D-2 let one member hold a tool others were queueing for. |

## Defaults

### Applied without asking

| Id | Default | Reason |
|---|---|---|
| X-1 | Amounts are integers in minor units. | Integer arithmetic has no rounding drift (ADR-001). |
| X-2 | The stack is TypeScript on Node.js 24 with pnpm. | The documents name no stack; this is their tooling. |

### Set in the design documents

| Id | Default | Reason |
|---|---|---|
| X-3 | Reminders go out two days before a due date. | Set in architecture §1.1. |

## Stack

| Field | Value |
|---|---|
| decision | X-2 |
| language | TypeScript |
| toolchain | Node.js 24 with pnpm 11 |
| scaffold | `package.json`, `pnpm-workspace.yaml` |

## Packages

| Package | Slot | Command |
|---|---|---|
| . | lint | `pnpm run lint` |
| . | test | `pnpm run test` |
| apps/desk | test | `pnpm --dir apps/desk test` |
