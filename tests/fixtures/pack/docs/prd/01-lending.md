# 01 — Lending

## 4. Functional requirements

- **LND-F-001** [M1] `POST /member/loans` MUST start a loan for a verified member (MEM-F-001),
  emit `loan.started`, and refuse a member with an overdue loan with `409` `loan_overdue`.
- **LND-F-002** [M1] A loan MUST last the setting `loan_days` (D-2; architecture §1.1).
- **LND-F-003** [withdrawn] Loans carried a paper slip number.
- **LND-F-004** [M2] `POST /member/loans/:id/extend` MUST extend a loan once, emit
  `loan.extended`, and answer `409` `extension_refused` while a reservation waits (D-5).
- **LND-F-005** [M1] The job `overdue-reminders` MUST remind each member two days before a due
  date (X-3), and a returned loan MUST emit `loan.returned`.

## 5. Non-functional requirements

- **LND-N-001** [M1] Starting a loan SHOULD answer within 300 ms at 10 requests per second.

## 7. Acceptance criteria

- **LND-AC-01** [M1] [E2E] Given a verified member and a tool, when the member calls
  `POST /member/loans`, then the loan starts and one `loan.started` event carries its id
  (LND-F-001, MEM-F-001).
- **LND-AC-02** [M1] Given member M with an overdue loan L, when M calls `GET /member/loans/L`
  and then `POST /member/loans`, then the first answers `200` and the second `409`
  `loan_overdue` (LND-F-001).
- **LND-AC-03** [M1] (LND-F-002, LND-F-005) Given `loan_days` 7, when a loan starts on day 0,
  then it is due on day 7 and its reminder goes out on day 5.
- **LND-AC-04** [M2] Given a loan and a waiting reservation, when the member asks to extend, then
  the answer is `409` `extension_refused` (LND-F-001–LND-F-002, LND-F-004).
- **LND-AC-05** [M1] Given 10 requests per second, when loans start, then the p95 is under 300 ms
  (LND-N-001).

## 10. Dependencies

- **S-1**: the spike that settles the card pre-authorisation (facts §2.1; ADR-001 §2).
