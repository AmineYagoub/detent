# Verified facts

## 1. The framework

| Id | Fact | Source | Tag |
|---|---|---|---|
| 1.1 | The framework's HTTP routes answer errors as `{ type, message, code }`. | https://example.org/framework/errors | doc |
| 1.2 | The framework's scheduler runs a job at most once per tick across workers. | https://example.org/framework/jobs, read in its source | source-read |

## 2. Payments

| Id | Fact | Source | Tag |
|---|---|---|---|
| 2.1 | The card provider holds a pre-authorisation for at most 7 days. | https://example.org/payments/holds | doc |
| 2.2 | The card provider retries a failed webhook three times. | https://example.org/payments/webhooks | unverified |
