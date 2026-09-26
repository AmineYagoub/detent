# 03 — Platform

- **PLT-F-001** [M0] The workspace MUST run `lint` and `test` from its root (the stack of X-2).
- **PLT-F-002** [M1] The webhook `POST /hooks/payment/:provider` MUST verify each event before it
  changes a deposit (architecture §2.1).
- **PLT-F-003** [M2] Admin routes under `/admin/loans` SHOULD page with `limit` and `offset`.

- **PLT-AC-01** [M0] Given a fresh checkout, when `pnpm run lint` and `pnpm run test` run, then
  both pass (PLT-F-001).
- **PLT-AC-02** [M1] Given a webhook with a bad signature, when it arrives, then no deposit
  changes (PLT-F-002).
- **PLT-AC-03** [M2] Given 30 loans, when `GET /admin/loans` is read with `limit` 20, then 20 come
  back and the next page holds 10 (PLT-F-003).
