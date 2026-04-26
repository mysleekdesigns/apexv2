import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
