/** Runs synthetic migration checks in temporary databases and removes all demo files. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { viewReview } from "../src/application/import-review.js";
const project = resolve(import.meta.dirname, "..");
const cli = resolve(project, "dist/cli/main.js");
const directory = mkdtempSync(join(tmpdir(), "inab-slice-2-demo-"));
const database = join(directory, "plan.sqlite");
const register = join(directory, "register.csv");
const plan = join(directory, "plan.csv");
const review = join(directory, "review.json");
function run(args: string[], expected = 0, target: string | null = database) {
  const prefix = target === null ? [] : ["--db", target];
  const result = spawnSync(process.execPath, [cli, ...prefix, ...args, "--json"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, expected, result.stderr);
  if (expected !== 0) {
    assert.equal(result.stdout, "");
    return JSON.parse(result.stderr);
  }
  return JSON.parse(result.stdout);
}
try {
  cpSync(resolve(project, "tests/fixtures/ynab/register.csv"), register);
  cpSync(resolve(project, "tests/fixtures/ynab/plan.csv"), plan);
  run(["init", "--confirm"]);
  let view: ReturnType<typeof viewReview> = run([
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
  const sourceAccount = view.sourceAccounts.at(0)?.key;
  assert.ok(sourceAccount);
  function change(action: string, selector: string, flags: string[]) {
    view = run([
      "setup",
      "migrate",
      action,
      selector,
      "--review",
      review,
      "--expected-review",
      String(view.revision),
      ...flags,
    ]);
  }
  change("account", sourceAccount, [
    "--name",
    "Synthetic cash",
    "--kind",
    "cash",
    "--closed",
    "no",
  ]);
  assert.deepEqual(run(["account", "list"]).accounts, []);
  view = run(["setup", "migrate", "review", "--review", review]);
  assert.equal(run(["setup", "status"]).state, "open");
  change("opening", sourceAccount, ["--as-of", "2026-10-22", "--balance", "100.00"]);
  change("acknowledge", `history:${sourceAccount}`, []);
  assert.equal(view.derived.ready, true);
  assert.equal(
    run(
      ["setup", "migrate", "commit", "--review", review, "--expected-review", "999", "--confirm"],
      4,
    ).reason,
    "stale-review",
  );
  assert.deepEqual(run(["account", "list"]).accounts, []);
  const receipt = run([
    "setup",
    "migrate",
    "commit",
    "--review",
    review,
    "--expected-review",
    String(view.revision),
    "--confirm",
  ]);
  assert.equal(receipt.report.sourceRows, 5);
  assert.equal(receipt.report.historyOnly, 5);
  const account = run(["import", "history", "accounts"]).accounts[0];
  const history = run(["import", "history", "register", account.accountId]).history;
  assert.equal(history.unverified.length, 3);
  assert.equal(
    history.unverified.filter((row: { cents: number }) => row.cents === -1234).length,
    2,
  );
  assert.equal(history.unverified.filter((row: { cents: number }) => row.cents === 0).length, 1);
  assert.equal(run(["import", "history", "plan", "--month", "2026-10"]).history.rows.length, 2);
  assert.equal(
    run(["import", "history", "report", receipt.importId]).report.importId,
    receipt.importId,
  );
  const backup = join(directory, "backup.sqlite");
  const restored = join(directory, "restored.sqlite");
  run(["backup", "--to", backup, "--confirm"]);
  run(["restore", "--from", backup, "--to", restored, "--confirm"], 0, null);
  assert.equal(run(["setup", "status"], 0, restored).state, "ynab");
  assert.equal(
    run(["import", "history", "register", account.accountId], 0, restored).history.unverified
      .length,
    3,
  );
  rmSync(register);
  assert.equal(
    run([
      "setup",
      "migrate",
      "commit",
      "--review",
      review,
      "--expected-review",
      String(view.revision),
      "--confirm",
    ]).reused,
    true,
  );
  assert.equal(
    run(
      [
        "setup",
        "migrate",
        "preview",
        "--register",
        register,
        "--plan",
        plan,
        "--review",
        join(directory, "later.json"),
      ],
      4,
    ).reason,
    "setup-closed",
  );
  const fresh = join(directory, "fresh.sqlite");
  run(["init", "--confirm"], 0, fresh);
  assert.equal(run(["setup", "fresh", "--confirm"], 0, fresh).state, "fresh");
  assert.equal(
    run(
      [
        "setup",
        "migrate",
        "preview",
        "--register",
        register,
        "--plan",
        plan,
        "--review",
        join(directory, "fresh-review.json"),
      ],
      4,
      fresh,
    ).reason,
    "setup-closed",
  );

  const tracking = join(directory, "tracking.sqlite");
  const trackingCsv = join(directory, "tracking.csv");
  const trackingReview = join(directory, "tracking-review.json");
  const headers = [
    "Account",
    "Flag",
    "Date",
    "Payee",
    "Category Group/Category",
    "Category Group",
    "Category",
    "Memo",
    "Outflow",
    "Inflow",
    "Cleared",
  ];
  const synthetic = [
    [
      "Example tracking",
      "",
      "10/01/2026",
      "Opening",
      "",
      "",
      "",
      "",
      "$0.00",
      "$100.00",
      "Cleared",
    ],
    [
      "Example tracking",
      "",
      "10/02/2026",
      "Withdrawal",
      "",
      "",
      "",
      "",
      "$15.00",
      "$0.00",
      "Cleared",
    ],
    ["Example tracking", "", "10/03/2026", "Deposit", "", "", "", "", "$0.00", "$15.00", "Cleared"],
    [
      "Example tracking",
      "",
      "10/04/2026",
      "Adjustment",
      "",
      "",
      "",
      "",
      "$0.00",
      "$25.00",
      "Cleared",
    ],
  ];
  const csv =
    [headers, ...synthetic]
      .map((fields) => fields.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
      .join("\n") + "\n";
  writeFileSync(trackingCsv, csv, { mode: 0o600 });
  run(["init", "--confirm"], 0, tracking);
  let tv: ReturnType<typeof viewReview> = run(
    [
      "setup",
      "migrate",
      "preview",
      "--register",
      trackingCsv,
      "--plan",
      plan,
      "--review",
      trackingReview,
    ],
    0,
    tracking,
  );
  const group = tv.sourceAccounts.at(0)?.key;
  assert.ok(group);
  function trackingChange(action: string, selector: string, flags: string[]) {
    tv = run(
      [
        "setup",
        "migrate",
        action,
        selector,
        "--review",
        trackingReview,
        "--expected-review",
        String(tv.revision),
        ...flags,
      ],
      0,
      tracking,
    );
  }
  trackingChange("account", group, [
    "--name",
    "Example tracking",
    "--kind",
    "tracking",
    "--closed",
    "no",
  ]);
  const roles = ["opening", "transaction", "transaction", "adjustment"];
  for (const [index, row] of tv.derived.rows.entries()) {
    assert.ok(row.source.value);
    const role = roles[index];
    assert.ok(role);
    trackingChange("row", row.key, [
      "--treatment",
      "posted",
      "--posted-on",
      row.source.value.occurredOn,
      "--role",
      role,
    ]);
  }
  const adjustment = tv.derived.rows.at(-1);
  assert.ok(adjustment);
  trackingChange("observation", group, [
    "--row",
    adjustment.key,
    "--as-of",
    "2026-10-04",
    "--balance",
    "130.00",
  ]);
  const observation = tv.observations.at(0);
  assert.ok(observation);
  assert.equal(observation.check.status, "needs-review");
  assert.equal(observation.check.recordedCents, 12500);
  trackingChange("resolve", observation.decision.key, ["--choice", "revise-adjustment"]);
  const revised = tv.observations.at(0);
  assert.ok(revised);
  assert.ok(revised.check.status !== "unverified");
  assert.equal(revised.check.adjustmentCents, 3000);
  const tr = run(
    [
      "setup",
      "migrate",
      "commit",
      "--review",
      trackingReview,
      "--expected-review",
      String(tv.revision),
      "--confirm",
    ],
    0,
    tracking,
  );
  assert.equal(tr.report.trackingAdjustments.revisionEffectCents, 500);
  const ta = run(["import", "history", "accounts"], 0, tracking).accounts[0];
  const th = run(["import", "history", "register", ta.accountId], 0, tracking).history;
  assert.equal(th.observations[0].observedCents, 13000);
  assert.equal(th.observations[0].originalAdjustmentCents, 2500);
  assert.equal(th.observations[0].currentAdjustmentCents, 3000);
  assert.equal(th.observations[0].state, "verified");
  console.log(
    JSON.stringify({
      syntheticDemo: "passed",
      sourceRows: receipt.report.sourceRows,
      trackingObservedCents: 13000,
      trackingAdjustmentCents: 3000,
    }),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
