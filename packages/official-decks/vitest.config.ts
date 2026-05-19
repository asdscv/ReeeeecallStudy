import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/presentation/cli.ts", "**/*.d.ts"],
      thresholds: {
        // Domain layer must be near-100%; application near-90%.
        // Set individually via per-path overrides when stricter is required.
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
