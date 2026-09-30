import { describe, expect, it } from "vitest";
import { routingAdvice, routingLine } from "../../src/kernel/routing-advice.js";

/**
 * S-5⁶ (PRDR-319) — the routing notes `doctor`, `init` and `run` share. The
 * line a note names is the one an operator edits, so it must be the role's
 * entry in `model_routing`, whatever order the file's keys are in:
 * `effort_routing` names the same roles.
 */
describe("S-5⁶ the routing notes name the line that moves a role", () => {
  const text = [
    "{",
    '  "effort_routing": {',
    '    "review": "xhigh"',
    "  },",
    '  "model_routing": {',
    '    "planner": "claude-opus-5-5",',
    '    "review": "claude-opus-5"',
    "  }",
    "}",
  ].join("\n");

  it("finds the role inside model_routing, not the same role in a table before it", () => {
    expect(routingLine(text, "review")).toBe(7);
    expect(routingLine(text, "planner")).toBe(6);
    expect(routingLine(text, "implement"), "a role the table does not name has no line").toBeNull();
    expect(routingLine('{"effort_routing":{"review":"max"}}', "review"), "no model_routing, no line").toBeNull();
  });

  it("names the key without a line when the file cannot be read, and says nothing when there is nothing to say", () => {
    expect(routingAdvice({ review: "claude-opus-5" }, "2.1.285", null).join("\n")).toContain('.detent/config.json "review": "claude-opus-5-5" (now claude-opus-5)');
    expect(routingAdvice({ review: "claude-opus-5-5" }, "2.1.285", text)).toEqual([]);
    expect(routingAdvice({ review: "claude-opus-5-5" }, null, text), "no runtime to judge against, and nothing superseded").toEqual([]);
  });

  it("says when the runtime's version cannot be read, rather than judging against it", () => {
    expect(routingAdvice({ implement: "claude-sonnet-5-5" }, "unknown", text).join("\n")).toMatch(/could not be read \(unknown\)/u);
  });
});
