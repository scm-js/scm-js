import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // One temporary folder for the run, removed at its end (tests/support/tmpdir.ts).
    globalSetup: ["tests/support/tmpdir.ts"],
  },
});
