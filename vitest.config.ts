import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // *.bench.ts runs as a test on purpose: N-4's bounds are CI-gating
    // assertions, and its filename is fixed normatively by the PRD.
    include: ["tests/**/*.test.ts", "tests/**/*.bench.ts"],
    environment: "node",
    // T-002: no watch-mode defaults — `vitest run` is the binding target.
    watch: false,
  },
});
