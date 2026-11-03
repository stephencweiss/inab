import { expect, it } from "vitest";
import { isSetupArguments, parseSetupArguments } from "../../src/cli/setup-parse.js";
it("parses dedicated setup and history commands with explicit target", () => {
  const parsed = parseSetupArguments([
    "--db",
    "/example/demo.sqlite",
    "setup",
    "migrate",
    "account",
    "source-a",
    "--review",
    "/example/review.json",
    "--name",
    "Cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "2",
    "--json",
  ]);
  expect(parsed).toMatchObject({
    action: "account",
    selector: "source-a",
    database: "/example/demo.sqlite",
    json: true,
  });
  expect(parsed.flags.get("--expected-review")).toBe("2");
  expect(
    parseSetupArguments([
      "import",
      "history",
      "register",
      "account-id",
      "--db",
      "/example/db",
      "--limit",
      "10",
    ]).action,
  ).toBe("history-register");
  expect(isSetupArguments(["--db", "/example/db", "setup", "status"])).toBe(true);
  expect(isSetupArguments(["--db", "setup", "account", "list"])).toBe(false);
});
it.each([
  ["setup", "status"],
  ["--db", "/example/db", "setup", "status", "--review", "r"],
  [
    "--db",
    "/example/db",
    "setup",
    "migrate",
    "commit",
    "--review",
    "r",
    "--expected-review",
    "0",
    "--confirm",
  ],
  [
    "--db",
    "/example/db",
    "setup",
    "migrate",
    "account",
    "s",
    "--review",
    "r",
    "--expected-review",
    "1",
    "--unknown",
  ],
  ["--db", "/example/db", "setup", "migrate", "review", "--review", "r", "--review", "s"],
  ["--db", "/example/db", "setup", "status", "extra"],
])("rejects invalid command %j", (...args) => {
  expect(() => parseSetupArguments(args)).toThrow();
});
