import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBoundaries } from "../../scripts/checks/boundaries.ts";

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "inab-boundaries-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        paths: { "@storage/*": ["./src/storage/*"], "@domain/*": ["./src/accounts/*"] },
      },
    }),
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("module boundaries", () => {
  it.each(["better-sqlite3", "node:fs", "fs/promises", "node:https", "undici"])(
    "rejects domain import of %s",
    (module) => {
      expect(
        checkBoundaries(fixture({ "src/accounts/rules.ts": `import value from "${module}";` })),
      ).not.toEqual([]);
    },
  );
  it.each([
    'export * from "../cli/main.js";',
    'export { value } from "@storage/database.js";',
    'const module = import("../storage/database.js");',
    'import module = require("../storage/database.js");',
    'type Row = import("../storage/database.js").Row;',
  ])("rejects forbidden import syntax: %s", (source) => {
    expect(
      checkBoundaries(
        fixture({
          "src/accounts/rules.ts": source,
          "src/storage/database.ts": "export const value = 1;",
          "src/cli/main.ts": "export {};",
        }),
      ),
    ).not.toEqual([]);
  });
  it.each(["../storage/database.js", "@storage/database.js", "node:fs", "node:crypto"])(
    "rejects application dependency %s",
    (module) => {
      expect(
        checkBoundaries(
          fixture({
            "src/application/accounts.ts": `import "${module}";`,
            "src/storage/database.ts": "export {};",
          }),
        ),
      ).not.toEqual([]);
    },
  );
  it("rejects direct database use from CLI", () => {
    expect(checkBoundaries(fixture({ "src/cli/main.ts": 'import "better-sqlite3";' }))).not.toEqual(
      [],
    );
  });
  it.each(["accounts", "budget", "lib", "application", "cli"])(
    "rejects computed import in %s",
    (directory) => {
      expect(
        checkBoundaries(
          fixture({
            [`src/${directory}/rules.ts`]: "const target = './other.js'; void import(target);",
          }),
        ),
      ).not.toEqual([]);
    },
  );
  it("rejects unresolved dependencies in restricted modules", () => {
    expect(
      checkBoundaries(fixture({ "src/accounts/rules.ts": 'export * from "@missing/rules";' })),
    ).not.toEqual([]);
  });
  it.each([
    ["accounts", "budget"],
    ["lib", "accounts"],
    ["budget", "accounts"],
  ])("rejects %s importing %s", (from, to) => {
    expect(
      checkBoundaries(
        fixture({
          [`src/${from}/rules.ts`]: `export * from "../${to}/values.js";`,
          [`src/${to}/values.ts`]: "export const value = 1;",
        }),
      ),
    ).not.toEqual([]);
  });
  it("accepts domain dependencies, application ports, CLI operations, and bootstrap wiring", () => {
    expect(
      checkBoundaries(
        fixture({
          "src/lib/money.ts": "export const cents = 1;",
          "src/accounts/rules.ts": 'export * from "../lib/money.js";',
          "src/application/ports.ts": "export type Store = { read(): number };",
          "src/application/accounts.ts":
            'import type { Store } from "./ports.js"; export * from "@domain/rules.js";',
          "src/storage/database.ts": 'import "better-sqlite3";',
          "src/bootstrap.ts":
            'export * from "./application/accounts.js"; export * from "./storage/database.js";',
          "src/cli/main.ts":
            'import "node:readline/promises"; import "./parse.js"; import "../bootstrap.js";',
          "src/cli/parse.ts": 'export * from "../application/accounts.js";',
        }),
      ),
    ).toEqual([]);
  });
});

describe("bootstrap import boundaries", () => {
  it("rejects nested import rules reaching unrelated parent account rules", () => {
    expect(
      checkBoundaries(
        fixture({
          "src/accounts/imports/review.ts": 'import "../reconciliation.js";',
          "src/accounts/reconciliation.ts": "export {};",
        }),
      ),
    ).not.toEqual([]);
  });
  it.each([
    "../../storage/database.js",
    "../../application/accounts.js",
    "node:sqlite",
    "better-sqlite3",
  ])("rejects adapter household dependency %s", (target) => {
    expect(
      checkBoundaries(
        fixture({
          "src/adapters/ynab/files.ts": `import "${target}";`,
          "src/storage/database.ts": "export {};",
          "src/application/accounts.ts": "export {};",
        }),
      ),
    ).not.toEqual([]);
  });
  it("accepts pure import rules and adapters using owned ports", () => {
    expect(
      checkBoundaries(
        fixture({
          "src/accounts/imports/review.ts":
            'import "./types.js"; import "../../lib/money.js"; import "../balances.js"; import "../register.js";',
          "src/accounts/imports/types.ts": "export {};",
          "src/accounts/balances.ts": "export {};",
          "src/accounts/register.ts": "export {};",
          "src/lib/money.ts": "export {};",
          "src/application/import-ports.ts": "export {};",
          "src/adapters/ynab/files.ts":
            'import "node:fs"; import "../../accounts/imports/types.js"; import "../../application/import-ports.js";',
        }),
      ),
    ).toEqual([]);
  });
});
