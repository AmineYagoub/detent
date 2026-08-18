import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, renderDoctor } from "../../src/cli/doctor.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/** T-050 — `detent doctor` (S-5, X-1 reporting, S-3 rule forms, R-10 smoke). */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

const named = (report: Awaited<ReturnType<typeof doctor>>, name: string) =>
  report.checks.find((c) => c.name === name);

describe("T-050 pin checks (S-5)", () => {
  it("a matching SDK pin passes; a mismatch fails naming BOTH versions", async () => {
    const root = await fixture(); // fixture pins agent_sdk 0.3.191 == installed
    const ok = await doctor(root, { installedSdkVersion: () => "0.3.191", env: {} });
    expect(named(ok, "agent-sdk-pin")?.ok).toBe(true);

    const bad = await doctor(root, { installedSdkVersion: () => "0.4.0", env: {} });
    const check = named(bad, "agent-sdk-pin");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("0.3.191");
    expect(check?.detail).toContain("0.4.0");
    expect(bad.exitCode).toBe(1);
  });

  it("the CLI pin rides the backend's own checkVersion, failing with its message", async () => {
    const root = await fixture();
    const backend = new MockBackend();
    // The mock accepts any pin (version-free) — passes.
    const ok = await doctor(root, { backend, installedSdkVersion: () => "0.3.191", env: {} });
    expect(named(ok, "claude-code-pin")?.ok).toBe(true);

    const failing = {
      ...backend,
      name: "mock",
      run: backend.run.bind(backend),
      checkVersion: async (pinned: string) => {
        throw new Error(`backend version mismatch (S-5): pinned=${pinned} installed=9.9.9`);
      },
    };
    const bad = await doctor(root, { backend: failing, installedSdkVersion: () => "0.3.191", env: {} });
    const check = named(bad, "claude-code-pin");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("2.1.191"); // the pin from config
    expect(check?.detail).toContain("9.9.9");
  });
});

describe("T-050 config reporting (X-1: the computation is authoritative)", () => {
  it("reports the computed worst case beside the configured net", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "0.3.191", env: {} });
    const check = named(report, "config");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("computed worst case 14");
    expect(check?.detail).toContain("net 18");
  });

  it("a missing config is a failing check, not a crash", async () => {
    const root = await fixture();
    rmSync(`${root}/.detent/config.json`);
    const report = await doctor(root, { installedSdkVersion: () => "0.3.191", env: {} });
    expect(named(report, "config")?.ok).toBe(false);
    expect(report.exitCode).toBe(1);
  });
});

describe("T-050 WebFetch rule form (S-3/PRDR-050)", () => {
  it("the composed domain-scoped form matches the pinned syntax", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "0.3.191", env: {} });
    expect(named(report, "webfetch-rule-form")?.ok).toBe(true);
  });
});

describe("T-050 smoke session (R-10)", () => {
  it("without a key the smoke SKIPS with the reason — the mock suite stays green keyless", async () => {
    const root = await fixture();
    const report = await doctor(root, { backend: new MockBackend(), installedSdkVersion: () => "0.3.191", env: {} });
    const check = named(report, "smoke-session");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("R-10");
  });

  it("with a key it runs one session and verifies telemetry parses end to end", async () => {
    const root = await fixture();
    const backend = new MockBackend({ review: () => okResult({ costEstimateUsd: 0.0003, turns: 1 }) });
    const report = await doctor(root, {
      backend,
      installedSdkVersion: () => "0.3.191",
      env: { ANTHROPIC_API_KEY: "test-key" },
    });
    const check = named(report, "smoke-session");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("smoke OK");
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]?.spec.permissionMode).toBe("plan"); // read-only smoke

    const failing = new MockBackend({ review: () => okResult({ telemetryParsed: false }) });
    const bad = await doctor(root, {
      backend: failing,
      installedSdkVersion: () => "0.3.191",
      env: { ANTHROPIC_API_KEY: "test-key" },
    });
    expect(named(bad, "smoke-session")?.ok).toBe(false);
    expect(bad.exitCode).toBe(1);
  });

  it("renderDoctor marks failures loudly", async () => {
    const root = await fixture();
    const report = await doctor(root, { installedSdkVersion: () => "9.9.9", env: {} });
    const rendered = renderDoctor(report);
    expect(rendered).toContain("[FAIL] agent-sdk-pin");
    expect(rendered).toContain("[ok] config");
  });
});
