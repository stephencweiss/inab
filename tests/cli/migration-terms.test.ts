import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderTermDictionary, termHelp } from "../../src/cli/migration-terms.js";
import type { MigrationTerm } from "../../src/cli/migration-terms.js";

const topics: MigrationTerm[] = [
  "setup",
  "review",
  "account-name",
  "account-kind",
  "closed-account",
  "opening-balance",
  "closing-balance-date",
  "posting-date",
  "observed-balance",
  "observation-date",
  "signed-usd",
  "source-row",
  "payee",
  "row-treatment",
  "row-role",
  "history-coverage",
  "observation",
  "resolution",
  "monthly-conflict",
  "review-choice",
  "import-confirmation",
  "source-files",
  "review-revision",
  "evidence",
];
it.each(topics)("gives plain text help and an offline reference for %s", (topic) => {
  const help = termHelp(topic);
  expect(help.trim().length).toBeGreaterThan(60);
  expect(help).toContain("Term dictionary: [");
  expect(help).toContain("](docs/term-dictionary.md#");
  expect(help).not.toMatch(/https?:\/\//);
  expect(help).not.toContain("undefined");
});
it("explains the opening balance, pending exclusion, and history counted once", () => {
  const help = termHelp("opening-balance");
  expect(help).toContain("initial posted balance in INAB");
  expect(help).toContain("end of the selected day");
  expect(help).toContain("excludes pending");
  expect(help).toContain("Do not count");
});
it("explains that the date default is local today rather than source evidence", () => {
  expect(termHelp("closing-balance-date")).toContain("excludes pending");
  expect(termHelp("closing-balance-date")).toContain("today in your local time zone");
  expect(termHelp("closing-balance-date")).toContain("not a date taken from the export");
  expect(termHelp("posting-date")).toContain("cleared");
  expect(termHelp("posting-date")).toContain("does not prove");
});
it("explains amount signs and explicit Tracking adjustment decisions", () => {
  const signed = termHelp("signed-usd");
  expect(signed).toContain("assets are positive");
  expect(signed).toContain("debt is negative");
  expect(signed).toContain("-12.34");
  expect(termHelp("observation")).toContain("target");
  expect(termHelp("observation")).toContain("external evidence");
  expect(termHelp("resolution")).toContain("defer");
  expect(termHelp("resolution")).toContain("unresolved");
  expect(termHelp("resolution")).toContain("original source evidence");
});
it("distinguishes saving a review choice from final import confirmation", () => {
  expect(termHelp("review-choice")).toContain("review file");
  expect(termHelp("review-choice")).toContain("does not import");
  expect(termHelp("review-choice")).toContain("database");
  expect(termHelp("import-confirmation")).toContain("explicit yes");
  expect(termHelp("import-confirmation")).toContain("No household records");
  expect(termHelp("import-confirmation")).toContain("closes further YNAB imports");
});
it("keeps the offline dictionary exactly in sync with the shared definitions", () => {
  const document = readFileSync(new URL("../../docs/term-dictionary.md", import.meta.url), "utf8");
  expect(document).toBe(renderTermDictionary());
  for (const topic of topics) {
    const title = termHelp(topic).split("\n")[0];
    expect(document).toContain(`## ${title}\n`);
  }
});

it("explains that choosing fresh closes migration even for an empty database", () => {
  const help = termHelp("setup");
  expect(help).toContain("fresh");
  expect(help).toContain("YNAB");
  expect(help).toContain("closes YNAB imports");
  expect(help).toContain("empty");
});

it("links each help topic to its offline dictionary heading", () => {
  for (const topic of topics) {
    const help = termHelp(topic);
    const title = help.split("\n")[0];
    if (!title) throw new Error("Missing help title");
    const anchor = title.toLowerCase().replaceAll(" ", "-");
    expect(help).toContain(`[${title}](docs/term-dictionary.md#${anchor})`);
  }
});

it("explains manual write confirmation separately from saving migration review choices", () => {
  const help = termHelp("write-confirmation");
  expect(help).toContain("displayed change");
  expect(help).toContain("explicit yes");
  expect(help).not.toContain("review file");
});
