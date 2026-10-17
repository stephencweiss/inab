import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("npm registry", () => {
  it("pins the public npm registry", () => {
    const registry = readFileSync(path.join(repositoryRoot, ".npmrc"), "utf8").trim();
    expect(registry).toBe("registry=https://registry.npmjs.org/");
  });

  it("pins Node.js 24.16.0", () => {
    expect(readFileSync(path.join(repositoryRoot, ".nvmrc"), "utf8").trim()).toBe("24.16.0");
  });
});
