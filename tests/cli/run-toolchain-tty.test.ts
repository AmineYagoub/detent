import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBindings, writeBindings } from "../../src/adapter/drift.js";
import { git, removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-276 — on a terminal, `detent run` asks the toolchain question itself.
 *
 * The other CLI tests hand `main` an asker, which stands in for this wiring
 * and so cannot test it: whether a terminal gets `makeTtyToolchainApproval`,
 * and nothing more permissive, is decided by the one TTY expression in
 * `cli/run.ts`. Here the streams claim a terminal and the line reader answers,
 * so the asker is the production one.
 */

const INSTALL_GO = process.platform === "darwin" ? "brew install go" : "sudo apt-get install -y golang-go";
const reader: { answer: string; asked: string[] } = { answer: "", asked: [] };

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: async (prompt: string): Promise<string> => {
      reader.asked.push(prompt);
      return reader.answer;
    },
    close: (): void => undefined,
  }),
}));

const { main: runMain } = await import("../../src/cli/run.js");

const roots: string[] = [];
const tty = { stdout: process.stdout.isTTY, stdin: process.stdin.isTTY };
beforeEach(() => {
  reader.asked = [];
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});
afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { value: tty.stdout, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: tty.stdin, configurable: true });
  for (const r of roots.splice(0)) removeTree(r);
});

async function goRepo(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  const current = readBindings(root);
  writeBindings(root, {
    bindings: current.bindings.map((b) => (b.slot === "test" ? { ...b, resolved: "go test ./..." } : b)),
    skips: [...current.skips],
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "bind the test gate to go");
  return root;
}

async function answered(answer: string): Promise<{ readonly code: number; readonly ran: readonly string[] }> {
  reader.answer = answer;
  const ran: string[] = [];
  let installed = false;
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const code = await runMain([await goRepo(), "--backend", "mock", "--no-worktree"], {
      toolchainProbe: () => installed,
      toolchainInstall: (exe, args) => {
        ran.push([exe, ...args].join(" "));
        installed = true;
      },
    });
    return { code, ran };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("PRDR-276 a terminal is asked, by the asker that reads a line", () => {
  it("asks `Install now? [y/N]`, and an empty line installs nothing", async () => {
    const said = await answered("");
    expect(reader.asked).toEqual(["\nInstall now? [y/N] "]);
    expect(said.ran).toEqual([]);
    expect(said.code).toBe(2);
  });

  it("a typed yes installs, and the run proceeds", async () => {
    const said = await answered("y");
    expect(said.ran).toEqual([INSTALL_GO]);
    expect(said.code).toBe(0);
  });
});
