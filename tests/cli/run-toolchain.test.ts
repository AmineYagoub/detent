import { afterEach, describe, expect, it, vi } from "vitest";
import { main as runMain } from "../../src/cli/run.js";
import { readBindings, writeBindings } from "../../src/adapter/drift.js";
import { git, removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-276 — the operator's answer to installing a toolchain, at the argv
 * boundary `detent run` is invoked through.
 *
 * Tested here and not only in the kernel, because PRDR-156 is what an untested
 * translation costs: a feature complete and covered one layer down, unreachable
 * from where the operator stands. `--install-toolchain` is the only thing that
 * can say yes without a terminal, so what it forwards is asserted, not read.
 */

const INSTALL_GO = process.platform === "darwin" ? "brew install go" : "sudo apt-get install -y golang-go";
const roots: string[] = [];
afterEach(() => {
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

interface Said {
  readonly code: number;
  readonly out: string;
  readonly ran: readonly string[];
}

/** `detent run` on a host without Go, whose installer records instead of installing. */
async function runOn(root: string, flags: readonly string[], asker?: (message: string) => Promise<boolean>): Promise<Said> {
  const ran: string[] = [];
  let installed = false;
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let code: number;
  let said: string;
  try {
    code = await runMain([root, "--backend", "mock", "--no-worktree", ...flags], {
      toolchainProbe: () => installed,
      toolchainInstall: (exe, args) => {
        ran.push([exe, ...args].join(" "));
        installed = true;
      },
      ...(asker === undefined ? {} : { approveToolchain: asker }),
    });
  } finally {
    /* PRDR-251: `mockRestore` resets the recorded calls, so the text is taken first. */
    said = out.mock.calls.join("");
    out.mockRestore();
    err.mockRestore();
  }
  return { code, out: said, ran };
}

describe("PRDR-276 `detent run` carries the toolchain answer from argv to the kernel", () => {
  it("`--install-toolchain` is the relayed yes: the table's command runs and the run proceeds", async () => {
    const said = await runOn(await goRepo(), ["--install-toolchain"]);
    expect(said.ran).toEqual([INSTALL_GO]);
    expect(said.code).toBe(0);
    expect(said.out, "the command is shown before it runs, flag or not").toContain(INSTALL_GO);
    expect(said.out, "and what it left behind is said once it has").toContain(`go: ${INSTALL_GO} — installed and resolves`);
  });

  it("with no flag and no terminal, nothing is installed and the refusal names the flag", async () => {
    const said = await runOn(await goRepo(), []);
    expect(said.code).toBe(2);
    expect(said.ran).toEqual([]);
    expect(said.out, "what is missing, and for which gate, is shown before the refusal").toContain("go — needed by test");
    expect(said.out).toContain("detent run --install-toolchain");
  });

  it("a terminal's no installs nothing", async () => {
    const said = await runOn(await goRepo(), [], async () => false);
    expect(said.code).toBe(2);
    expect(said.ran).toEqual([]);
  });

  it("a terminal's yes installs", async () => {
    const said = await runOn(await goRepo(), [], async () => true);
    expect(said.ran).toEqual([INSTALL_GO]);
    expect(said.code).toBe(0);
  });

  it("the flag is the answer: given in advance, it is not asked again", async () => {
    let asked = 0;
    const said = await runOn(await goRepo(), ["--install-toolchain"], async () => {
      asked += 1;
      return false;
    });
    expect(asked).toBe(0);
    expect(said.ran).toEqual([INSTALL_GO]);
  });
});
