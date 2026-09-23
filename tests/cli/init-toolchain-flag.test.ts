import { afterEach, describe, expect, it, vi } from "vitest";
import { main as initMain } from "../../src/cli/init.js";
import { MockBackend } from "../../src/sessions/mock.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import type { PipelineDeps } from "../../src/init/pipeline.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-274 — `--install-toolchain` is the operator's approval, and the only
 * thing that can turn the installer on.
 *
 * Tested at the argv boundary rather than only at the adapter, because PRDR-156
 * is what an untested translation costs: `note` was complete, covered at the
 * adapter layer, and forwarded by every handler but one, so the feature was
 * unreachable and the suite was green. A default flipped to `true` here would
 * install a global toolchain on a machine whose operator asked for nothing.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
  vi.unstubAllEnvs();
});

function accepting(): SessionBackend {
  const backend: SessionBackend = new MockBackend();
  backend.checkVersion = async (): Promise<void> => undefined;
  return backend;
}

/** Runs `init` far enough to build the pipeline, records the deps, and stops there. */
async function depsFor(argv: readonly string[]): Promise<PipelineDeps> {
  const { root } = await makeRunRepo();
  roots.push(root);
  vi.stubEnv("DETENT_NO_LIVE", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-fixture");

  let seen: PipelineDeps | null = null;
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await initMain([root, ...argv], {
      buildBackend: () => accepting(),
      buildPipeline: (deps) => {
        seen = deps;
        return [];
      },
    });
  } finally {
    err.mockRestore();
    out.mockRestore();
  }
  if (seen === null) throw new Error("init never reached buildPipeline");
  return seen;
}

describe("PRDR-274 the installer is off unless the operator asked for it", () => {
  it("a plain `detent init` forwards no approval", async () => {
    expect((await depsFor([])).installToolchain).toBeUndefined();
  }, 60_000);

  it("`--install-toolchain` forwards it", async () => {
    expect((await depsFor(["--install-toolchain"])).installToolchain).toBe(true);
  }, 60_000);
});
