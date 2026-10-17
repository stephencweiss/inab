import { describe, expect, it } from "vitest";
import { runChecks, CHECKS } from "../../scripts/checks/runner.ts";

describe("full check runner", () => {
  it("forwards the first failure and stops before later success", () => {
    const visited: string[] = [];
    const result = runChecks((name) => {
      visited.push(name);
      return name === "check:tracked" ? 7 : 0;
    });
    expect(result).toBe(7);
    expect(visited).toEqual(["check:documents", "check:tracked"]);
  });
  it("runs every installed check including secrets and build", () => {
    const visited: string[] = [];
    expect(
      runChecks((name) => {
        visited.push(name);
        return 0;
      }),
    ).toBe(0);
    expect(visited).toEqual([
      "check:documents",
      "check:tracked",
      "check:boundaries",
      "check:format",
      "lint",
      "typecheck",
      "test",
      "check:secrets",
      "build",
    ]);
    expect(CHECKS).toEqual(visited);
  });
});
