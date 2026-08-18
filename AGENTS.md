# Rules

Engineering standards for this repository. Two audiences, one file: agents and
humans editing this code — and, because `RefereeCore.readRules()` feeds this
file to every session Detent launches, the agents Detent itself runs during a
self-build (N-7). Rules marked **[lint]** are enforced by `npm run lint` and
CI; the rest are enforced by review. When a rule here collides with the PRD or
the implementation plan, the PRD wins and this file gets fixed.

## Files

- **≤ 300 code lines per `src/` file; ≤ 600 per test file** — counted with
  blank lines and comments skipped. **[lint: `max-lines`]** Split by
  responsibility when approaching the ceiling, never mechanically: a cohesive
  concern that cannot fit in 300 lines is a design smell to fix, not a number
  to dodge.
- One module, one job. Name files after the thing they own (`escrow`, not
  `utils`). No `helpers.ts`/`utils.ts` grab-bags in `src/`.
- No default exports; named exports only. **[lint]**

## Comments

- **No inline comments** — a comment never shares a line with code.
  **[lint: `no-inline-comments`]**
- No narration. A comment that restates what the next line does is deleted on
  sight; the fix for unclear code is clearer code.
- Comments state what the code cannot: the constraint, the invariant, the
  deliberate deviation — and cite the requirement that demands it
  (`C-9`, `ARCH-1`, `D-27`, a PRDR). This repo's doc-blocks are load-bearing:
  the parity map requires test files to cite their closing ticket, and the
  audit tests quote requirement ids. Keep writing them; keep them at
  block level (`/** … */` above the declaration).
- `TODO` requires a ticket id or it does not merge.

## Language

- Modern TypeScript, strict. The compiler options are law:
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — never
  weaken them, never `@ts-ignore`/`@ts-expect-error` around them in `src/`.
- ESM only, NodeNext resolution, `node:`-prefixed builtins, explicit `.js`
  specifiers on relative imports.
- `const` by default; `let` only when reassignment is the point; never `var`.
  **[lint: `prefer-const`, `no-var`]**
- Use the modern operators where they say it better: `?.`, `??`, spread,
  destructuring, template literals **[lint: `prefer-template`]**, object
  shorthand **[lint: `object-shorthand`]**, `at(-1)` over `arr[arr.length-1]`.
- `===`/`!==` always (null-checks may use `== null`). **[lint: `eqeqeq`]**
- `async`/`await` over `.then` chains; arrow functions for callbacks.
  **[lint: `prefer-arrow-callback`]**
- No `enum` — union types of string literals carry the same meaning with zero
  runtime and honest JSON. **[lint]**
- No `any` in `src/`; model unknown data as `unknown` and parse it through a
  zod schema at the boundary (`schemas/**` is the vocabulary — reuse it).
- Type-only imports are marked as such (`import type { X }`, or
  `import { fn, type X }`). **[lint: `consistent-type-imports`]**
- Public data shapes are `readonly`; interfaces over type aliases for object
  contracts; discriminated unions over boolean flags.

## Errors

- Typed error classes with a `name`, thrown once, mapped at the boundary —
  never stringly-typed control flow. A structured error a caller must route is
  part of the contract; document its codes.
- An empty `catch` carries a block comment saying why swallowing is correct.
- No `console.*` in `src/`; user-facing text flows through the caller's
  `print`/`note`/`announce` seams.

## Architecture (a reminder, enforced elsewhere)

- ARCH-1's import zones and the apply-site audit are the boundary's law:
  drivers never touch `machine.apply`, event constructors, or event names;
  layers below the kernel never import mutators. The lint zones and
  `tests/arch/**` enforce this — do not loosen either to make a change fit.
- Determinism everywhere the referee stands: no `Date.now()`/randomness in
  decision paths without an injectable seam (`now?: () => number`).

## Tests

- Tests before code where an oracle exists; every test file cites the ticket
  it closes (the parity map checks this).
- One behavior per test; fixtures over mocks where the real thing is cheap
  (real git repos, real gate scripts).
- `.only`/`.skip` never merge; a skip that must stay carries its ticket id.
