# Catalogues

## 1. Error codes

| Code | Status | Meaning |
|---|---|---|
| `loan_overdue` | `409` | A member with an overdue loan asks for another. |
| `extension_refused` | `409` | An extension while a reservation waits (D-5). |
| `member_unverified` | `403` | A member whose identity is not checked asks for a loan. |

## 2. Events

| Event | Payload |
|---|---|
| `loan.started` | the loan id |
| `loan.extended` | the loan id and its new due date |
| `loan.returned` | the loan id |

### 2.1 The framework's own events

| Event | Source |
|---|---|
| `payment.webhook_received` | the framework (facts §1.2) |

## 3. Settings

| Setting | Default |
|---|---|
| `loan_days` | 7 |
| `reminder_days` | 2 (X-3) |

## Deposit bands

The deposit each tool band takes, read by the `deposit_band` rule of architecture §2.1.

| Band | Deposit |
|---|---|
| hand tools | 2,000 |
| power tools | 10,000 |

## 4. Jobs

| Job | Schedule |
|---|---|
| `overdue-reminders` | daily 08:00 |
| `deposit-release` | hourly |

## 5. Configuration

| Variable | Meaning |
|---|---|
| `TOOLSHED_CARD_KEY` | the card provider's key |

## 6. Routes

| Route | Purpose |
|---|---|
| `GET/POST /member/loans` | List and start loans. |
| `GET /member/loans/:id` | Read a loan. |
| `POST /member/loans/:id/{extend,return}` | Extend or return a loan. |
| `GET /admin/loans[/:id]` | List loans, or read one. |
| `POST /admin/members/:id/verify` | Mark a member verified. |
| `POST /hooks/payment/:provider` | The card provider's webhook. |
