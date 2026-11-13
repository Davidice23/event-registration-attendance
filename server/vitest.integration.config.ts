import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Integration suites share and clean the same dedicated PostgreSQL test database.
    // Serialize files so one suite cannot delete fixtures while another is using them.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
