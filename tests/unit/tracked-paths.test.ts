import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blockedCandidateFiles, blockedTrackedPath } from "../../scripts/checks/tracked-paths.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("tracked paths", () => {
  it("blocks household exports, databases, profiles, and real environment files", () => {
    expect(blockedTrackedPath("ynab-export/register.csv")).toBe("export");
    expect(blockedTrackedPath("data/household.sqlite")).toBe("household data");
    expect(blockedTrackedPath("backups/plan.db")).toBe("backup");
    expect(blockedTrackedPath("private/note.txt")).toBe("private data");
    expect(blockedTrackedPath("browser-profiles/session/cookies")).toBe("browser profile");
    expect(blockedTrackedPath(".env")).toBe("environment file");
    expect(blockedTrackedPath(".env.local")).toBe("environment file");
    expect(blockedTrackedPath("accounts.sqlite-wal")).toBe("database");
  });

  it("allows the example environment file and synthetic fixtures", () => {
    expect(blockedTrackedPath(".env.example")).toBeNull();
    expect(blockedTrackedPath("tests/fixtures/account.sqlite")).toBeNull();
    expect(blockedTrackedPath("tests/fixtures/export.csv")).toBeNull();
    expect(blockedTrackedPath("docs/verification.md")).toBeNull();
  });

  it("finds no private candidate files in this repository", () => {
    expect(blockedCandidateFiles(repositoryRoot)).toEqual([]);
  });
});
