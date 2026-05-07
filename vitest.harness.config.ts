import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const coreEntry = fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@harness/core": coreEntry
    }
  },
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/cli/src/cli.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80
      }
    }
  }
});
