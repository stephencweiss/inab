import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /** CLI and policy tests spawn child processes; serialize suites to bound shared CPU load. */
    maxWorkers: 1,
    include: ["tests/{unit,integration,cli,policy}/**/*.test.ts"],
  },
});
