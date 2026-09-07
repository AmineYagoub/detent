import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // *.bench.ts runs as a test on purpose: N-4's bounds are CI-gating
    // assertions, and its filename is fixed normatively by the PRD.
    include: ["tests/**/*.test.ts", "tests/**/*.bench.ts"],
    environment: "node",
    // T-002: no watch-mode defaults — `vitest run` is the binding target.
    watch: false,
    /**
     * Much of this suite shells out to real `git` in real fixture repos, and
     * vitest runs those files in parallel. Individual tests take 0.3-1.2s idle,
     * but under load four of them regularly blew the 5s default and failed as
     * timeouts — a green suite one run and four red the next, which is the one
     * thing a suite that gates a self-build must never do. 20s is ~16x the
     * slowest observed test: enough headroom for a loaded machine, still short
     * enough that a genuine hang fails rather than hanging CI.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
