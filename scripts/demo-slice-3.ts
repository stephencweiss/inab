/** Runs only synthetic budget workflows through the built CLI in private temporary directories. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BudgetFacts } from "../src/budget/types.js";
const project = resolve(import.meta.dirname, "..");
const cli = join(project, "dist/cli/main.js");
const date = new Date();
const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const months: string[] = [];
for (
  let year = 2026, month = 10;
  `${year}-${String(month).padStart(2, "0")}` <= today.slice(0, 7);
) {
  months.push(`${year}-${String(month).padStart(2, "0")}`);
  if (month === 12) {
    year++;
    month = 1;
  } else month++;
}
assert.ok(months.includes("2026-11"), "Demo requires November 2026 or later");
for (const mode of ["fresh", "migrated"]) {
  const directory = mkdtempSync(join(tmpdir(), "inab-slice-3-demo-")),
    database = join(directory, "plan.sqlite");
  function run(args: string[], expected = 0, target: string | null = database) {
    const result = spawnSync(
      process.execPath,
      [cli, ...(target === null ? [] : ["--db", target]), ...args, "--json"],
      { cwd: directory, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, expected, result.stderr);
    if (expected !== 0) {
      assert.equal(result.stdout, "");
      return JSON.parse(result.stderr);
    }
    return JSON.parse(result.stdout);
  }
  function budget(args: string[], expected = 0) {
    return run(["budget", ...args], expected);
  }
  function write(args: string[]) {
    return budget([
      ...args,
      "--expected-version",
      String(budget(["status"]).revision),
      "--confirm",
    ]);
  }
  try {
    run(["init", "--confirm"]);
    let cashId: string;
    if (mode === "fresh")
      cashId = run([
        "account",
        "add",
        "--name",
        "Synthetic cash",
        "--kind",
        "cash",
        "--opening",
        "1000.00",
        "--as-of",
        "2026-09-30",
        "--confirm",
      ]).account.id;
    else {
      const register = join(directory, "register.csv"),
        plan = join(directory, "plan.csv"),
        review = join(directory, "migration.json");
      writeFileSync(
        register,
        readFileSync(join(project, "tests/fixtures/ynab/register.csv"), "utf8").replaceAll(
          "10/22/2026",
          "09/15/2026",
        ),
      );
      writeFileSync(
        plan,
        readFileSync(join(project, "tests/fixtures/ynab/plan.csv"), "utf8").replaceAll(
          "Oct 2026",
          "Sep 2026",
        ),
      );
      let view = run([
        "setup",
        "migrate",
        "preview",
        "--register",
        register,
        "--plan",
        plan,
        "--review",
        review,
      ]);
      const key: string = view.sourceAccounts[0].key;
      function change(action: string, flags: string[]) {
        view = run([
          "setup",
          "migrate",
          action,
          key,
          "--review",
          review,
          "--expected-review",
          String(view.revision),
          ...flags,
        ]);
      }
      change("account", ["--name", "Synthetic imported cash", "--kind", "cash", "--closed", "no"]);
      change("opening", ["--as-of", "2026-09-30", "--balance", "1000.00"]);
      view = run([
        "setup",
        "migrate",
        "acknowledge",
        `history:${key}`,
        "--review",
        review,
        "--expected-review",
        String(view.revision),
      ]);
      assert.equal(view.derived.ready, true);
      run([
        "setup",
        "migrate",
        "commit",
        "--review",
        review,
        "--expected-review",
        String(view.revision),
        "--confirm",
      ]);
      cashId = run(["account", "list"]).accounts[0].id;
      assert.ok(run(["import", "history", "plan", "--month", "2026-09"]).history.rows.length > 0);
    }
    const cardId: string = run([
      "account",
      "add",
      "--name",
      "Synthetic card",
      "--kind",
      "credit",
      "--opening",
      "0.00",
      "--as-of",
      "2026-09-30",
      "--confirm",
    ]).account.id;
    const categories = [
      { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
      {
        id: "payment",
        groupId: "cards",
        name: "Card payment",
        archived: false,
        cardAccountId: cardId,
      },
    ];
    const facts: BudgetFacts = {
      startMonth: "2026-10",
      currency: "USD",
      categories,
      opening: {
        accounts: [
          {
            accountId: cashId,
            kind: "cash",
            balanceCents: 100000,
            closed: false,
            evidence: "Synthetic September closing statement",
          },
          {
            accountId: cardId,
            kind: "credit",
            balanceCents: 0,
            closed: false,
            evidence: "Synthetic zero card",
          },
        ],
        categories: categories.map((c) => ({
          categoryId: c.id,
          availableCents: 0,
          evidence: "Reviewed zero",
        })),
        readyToAssignCents: 100000,
        evidence: "Complete synthetic opening",
        deficitAcknowledged: false,
      },
      assignments: months.flatMap((month) =>
        categories.map((c) => ({ month, categoryId: c.id, amountCents: 0 })),
      ),
      events: [],
    };
    const review = join(directory, "budget.json");
    budget(["activation", "start", "--month", "2026-10", "--review", review]);
    assert.equal(
      budget(["activation", "preview", "--review", review], 2).reason,
      "activation-review-incomplete",
    );
    budget([
      "activation",
      "set",
      "--review",
      review,
      "--expected-review",
      "1",
      "--decision",
      JSON.stringify({
        kind: "facts",
        facts,
        coverage: {
          throughDate: today,
          evidence: "All synthetic activity checked",
          includedTransactionIds: [],
          postedBridgeEventIds: [],
        },
      }),
    ]);
    const preview = budget(["activation", "preview", "--review", review]);
    const commit = [
      "activation",
      "commit",
      "--review",
      review,
      "--expected-review",
      String(preview.review.revision),
      "--confirm",
    ];
    budget(commit);
    assert.equal(budget(commit).reused, true);
    write(["assign", "--month", "2026-10", "--category", "food", "--amount", "200.00"]);
    const purchase = run([
      "transaction",
      "add",
      "--account",
      cardId,
      "--date",
      "2026-10-02",
      "--amount",
      "-60.00",
      "--payee",
      "Synthetic shop",
      "--confirm",
    ]).transaction;
    assert.equal(budget(["show", "--month", "2026-10"]).month.complete, false);
    write(["allocate", purchase.id, "--category", "food", "--expected-transaction-version", "1"]);
    let report = budget(["show", "--month", "2026-10"]).month;
    assert.equal(
      report.categories.find((c: { categoryId: string }) => c.categoryId === "food").availableCents,
      14000,
    );
    assert.equal(report.cards[0].reserveCents, 6000);
    write(["allocate", purchase.id, "--unallocated", "--expected-transaction-version", "1"]);
    run([
      "transaction",
      "edit",
      purchase.id,
      "--date",
      "2026-10-02",
      "--amount",
      "-55.00",
      "--payee",
      "Synthetic shop",
      "--memo",
      "Synthetic correction",
      "--expected-version",
      "1",
      "--confirm",
    ]);
    write(["allocate", purchase.id, "--category", "food", "--expected-transaction-version", "2"]);
    run([
      "transaction",
      "clear",
      purchase.id,
      "--posted-on",
      "2026-10-03",
      "--expected-version",
      "2",
      "--confirm",
    ]);
    const accounts = run(["account", "list"]).accounts;
    write([
      "transfer",
      "add",
      "--from",
      cashId,
      "--to",
      cardId,
      "--date",
      "2026-10-04",
      "--amount",
      "55.00",
      "--expected-from-version",
      String(accounts.find((a: { id: string }) => a.id === cashId).revision),
      "--expected-to-version",
      String(accounts.find((a: { id: string }) => a.id === cardId).revision),
    ]);
    write(["assign", "--month", "2026-11", "--category", "food", "--amount", "50.00"]);
    report = budget(["show", "--month", "2026-11"]).month;
    assert.equal(report.readyToAssignCents, 75000);
    assert.equal(report.heldFundsCents, 94500);
    assert.equal(
      report.categories.find((c: { categoryId: string }) => c.categoryId === "food").availableCents,
      19500,
    );
    assert.equal(report.cards[0].reserveCents, 0);
    assert.equal(report.cards[0].balanceCents, 0);
    assert.equal(report.complete, true);
    assert.equal(
      budget(
        [
          "assign",
          "--month",
          "2026-10",
          "--category",
          "food",
          "--amount",
          "100.00",
          "--expected-version",
          "1",
          "--confirm",
        ],
        4,
      ).reason,
      "stale-version",
    );
    assert.equal(budget(commit).reused, true);
    const backup = join(directory, "backup.sqlite"),
      restored = join(directory, "restored.sqlite");
    run(["backup", "--to", backup, "--confirm"]);
    run(["restore", "--from", backup, "--to", restored, "--confirm"], 0, null);
    assert.deepEqual(run(["budget", "show", "--month", "2026-11"], 0, restored).month, report);
    process.stdout.write(
      `Slice 3 ${mode}: activation, assignments, card correction/payment, month change, stale refusal, retry, and restore passed.\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
