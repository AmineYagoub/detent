import { CEILINGS, type Budgets, type CeilingKey } from "../src/schemas/budgets.js";
import type { GuardContext } from "../src/kernel/machine.js";

export const DEFAULT_BUDGETS: Budgets = Object.fromEntries(
  (Object.keys(CEILINGS) as CeilingKey[]).map((k) => [
    k,
    "default" in CEILINGS[k] ? (CEILINGS[k] as { default: number }).default : 25,
  ]),
) as Budgets;

export function ctx(type: "feature" | "bug" = "feature", budgets: Budgets = DEFAULT_BUDGETS): GuardContext {
  return { ticket: { type }, budgets };
}
