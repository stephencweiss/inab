import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /** CLI and policy tests spawn child processes; bound their shared CPU load. */
    maxWorkers: 4,
    include: ["tests/{unit,integration,cli,policy}/**/*.test.ts"],
  },
});
