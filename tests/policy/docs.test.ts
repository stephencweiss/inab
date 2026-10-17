import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocuments } from "../../scripts/checks/documents.ts";

const roots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "inab-docs-"));
  roots.push(root);
  return root;
}

function writeRepository(root: string, readmeLinks: string, agentLinks: string, extra = ""): void {
  mkdirSync(path.join(root, "docs", "conventions"), { recursive: true });
  writeFileSync(path.join(root, "docs", "conventions", "one.md"), "# One\n");
  writeFileSync(path.join(root, "README.md"), `# INAB\n\n## Conventions\n\n${readmeLinks}\n`);
  writeFileSync(
    path.join(root, "AGENTS.md"),
    `# Agents\n\n## Conventions\n\n${agentLinks}\n${extra}`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("document checks", () => {
  it("accepts matching convention lists and local links", () => {
    const root = createRoot();
    const link = "- [One](docs/conventions/one.md)";
    writeRepository(root, link, link);

    expect(checkDocuments(root)).toEqual([]);
  });

  it("reports a convention list that differs from the readme", () => {
    const root = createRoot();
    writeRepository(root, "- [One](docs/conventions/one.md)", "- [Other](docs/conventions/one.md)");

    expect(checkDocuments(root).map((problem) => problem.message)).toEqual([
      "Convention list does not match README.md.",
    ]);
  });

  it("reports a local link whose target is missing", () => {
    const root = createRoot();
    const link = "- [Missing](docs/conventions/missing.md)";
    writeRepository(root, link, link);

    const messages = checkDocuments(root).map((problem) => problem.message);
    expect(messages.some((message) => message.includes("missing.md"))).toBe(true);
  });

  it("accepts this repository", () => {
    expect(checkDocuments(repositoryRoot)).toEqual([]);
  });
});
