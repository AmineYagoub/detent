import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // T-002: no watch-mode defaults — `vitest run` is the binding target.
    watch: false,
  },
});
