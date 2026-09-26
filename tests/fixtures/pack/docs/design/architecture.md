# Architecture

## 1. Modules

Lending owns loans, members own identity, notifications own every message (D-1).

### 1.1 Lending

A loan runs seven days (D-2) and can be extended once unless a reservation waits (D-5). Its
routes live under `/member/loans`, and reminders go out two days before the due date (X-3).

### 1.2 Members

Identity is checked once, at sign-up; the provider's error shape is facts §1.1.

## 2. Money

### 2.1 Deposits

A deposit is an integer in minor units (X-1; ADR-001 §2), held as a card pre-authorisation,
which lasts at most 7 days (facts §2.1–§2.2). See [the catalogues](catalogues.md).
