import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { servedSession } from "../../src/cli/referee.js";

/**
 * D-27‴ (PRDR-099) — what ties the referee to the Claude session that started
 * it: the session id Claude Code gives the servers it starts, and the two pids
 * the referee runs under, its parent and the process above it.
 */

describe("D-27‴ the referee reads the session it serves (PRDR-099)", () => {
  it("records the session id Claude Code gave it, and its parent and the process above that", () => {
    const asked: number[] = [];
    const served = servedSession({ CLAUDE_CODE_SESSION_ID: "session-1" }, (pid) => {
      asked.push(pid);
      return 4242;
    });
    expect(served).toEqual({ session_id: "session-1", parents: [process.ppid, 4242] });
    expect(asked).toEqual([process.ppid]);
  });

  it("records no session id where none was given, and the parent alone where the one above cannot be read", () => {
    expect(servedSession({}, () => null)).toEqual({ parents: [process.ppid] });
    expect(servedSession({ CLAUDE_CODE_SESSION_ID: "" }, () => null)).toEqual({ parents: [process.ppid] });
  });

  it("reads the process above its parent from the operating system", () => {
    const above = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" }).trim());
    expect(servedSession({}).parents).toEqual(above > 1 ? [process.ppid, above] : [process.ppid]);
  });
});
