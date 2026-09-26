# 02 — Members and notifications

## 4. Functional requirements

- **MEM-F-001** [M1] `POST /admin/members/:id/verify` MUST mark a member verified, and a member
  that is not verified MUST get `403` `member_unverified` when it asks for a loan.
- **NTF-F-001** [M1] Every reminder MUST be sent in the member's language.
- **NTF-F-002** [M2] A reservation notice SHOULD reach the member within a minute.

## 7. Acceptance criteria

- **MEM-AC-01** [M1] Given an unverified member, when it calls `POST /member/loans`, then the
  answer is `403` `member_unverified`; after `POST /admin/members/:id/verify`, the loan starts
  (MEM-F-001).
- **NTF-AC-01** [M1] Given a member whose language is French, when a reminder is due, then it is
  sent in French (NTF-F-001).
- **NTF-AC-02** [M2] Given a reservation that becomes available, when the notice is sent, then it
  arrives within a minute (NTF-F-002).
