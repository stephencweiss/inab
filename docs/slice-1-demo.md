# Slice 1 manual demo

Status: implemented; pending user manual review. Use synthetic data only.

This demo creates a new temporary directory. It uses the built CLI from outside the repository. It does not read household files. All backup and restore targets are new files in that directory. Keep the output until review is complete.

## Build

Use Node.js 24.16.0 and npm. Run this block first. A failure stops this subshell, not your terminal.

```bash
(
  set -eu
  cd /Users/sweiss/code/inab
  npm ci
  npm run build
)
```

## Run the complete workflow

Paste this whole block into a terminal. It needs only Bash and Node.js. Each printed `node` command is executed with the listed arguments. IDs and revisions come from JSON results. No ID needs to be copied. JSON amounts are integer cents.

Each command must exit with code 0 unless the script explicitly expects 4 or 2. The script checks those codes directly. It also checks balances, saved evidence, and restored views. An unexpected result stops the demo with a nonzero exit code. A failed run keeps its directory for inspection; use a new directory for a retry.

```bash
(
  set -eu
  INAB_DEMO_DIR=$(mktemp -d "${TMPDIR:-/tmp}/inab-slice-1-demo.XXXXXX")
  export INAB_DEMO_DIR
  echo "Demo files: $INAB_DEMO_DIR"
  cd "$INAB_DEMO_DIR"
  node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = '/Users/sweiss/code/inab/dist/cli/main.js';
const directory = process.env.INAB_DEMO_DIR;
const database = join(directory, 'plan.sqlite');
const backup = join(directory, 'backup.sqlite');
const restored = join(directory, 'restored.sqlite');

function execute(args, expected = 0) {
  console.log('\nnode ' + [cli, ...args].map(value => JSON.stringify(value)).join(' '));
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`Exit: ${result.status}; expected: ${expected}`);
  assert.equal(result.status, expected);
  if (expected !== 0) return result;
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  return data;
}
const run = (...args) => execute(['--db', database, ...args, '--json']);
const copyView = (...args) => execute(['--db', restored, ...args, '--json']);

// Create cash and keep the generated account ID.
run('init', '--confirm');
const cash = run('account', 'add', '--name', 'Synthetic recovery cash',
  '--kind', 'cash', '--opening', '100.00', '--as-of', '2026-10-01', '--confirm').account;
const posted = run('transaction', 'add', '--account', cash.id,
  '--date', '2026-10-04', '--posted-on', '2026-10-05', '--amount', '-10.00',
  '--payee', 'Synthetic shop', '--confirm').transaction;
const pending = run('transaction', 'add', '--account', cash.id,
  '--date', '2026-10-04', '--amount', '-5.00',
  '--payee', 'Synthetic pending shop', '--confirm').transaction;
let register = run('register', cash.id);
assert.deepEqual(register.balances, {
  workingCents: 8500, clearedCents: 9000, unclearedCents: -500,
});
assert.equal(register.entries.length, 2);
assert.equal(register.entries.find(entry => entry.id === pending.id).clearance, 'uncleared');

// A wrong bank balance exits 4 and saves no check or adjustment.
execute(['--db', database, 'reconcile', cash.id, '--as-of', '2026-10-10',
  '--bank-balance', '91.00', '--confirm', '--json'], 4);
assert.equal(run('reconciliation', 'list', '--account', cash.id).reconciliations.length, 0);
assert.deepEqual(run('register', cash.id), register);
const first = run('reconcile', cash.id, '--as-of', '2026-10-10',
  '--bank-balance', '90.00', '--confirm').reconciliation;
assert.equal(first.status, 'valid');
assert.equal(first.computedCents, 9000);

// Correct the purchase with its returned ID and revision.
const corrected = run('transaction', 'edit', posted.id, '--date', '2026-10-04',
  '--amount', '-11.00', '--payee', 'Synthetic shop', '--memo', 'Synthetic correction',
  '--expected-version', String(posted.revision), '--confirm').transaction;
assert.equal(corrected.id, posted.id);
assert.equal(corrected.revision, 2);
let checks = run('reconciliation', 'list', '--account', cash.id).reconciliations;
assert.equal(checks.find(check => check.id === first.id).status, 'needs-review');
assert.equal(checks.find(check => check.id === first.id).entries[0].cents, -1000);
register = run('register', cash.id);
assert.deepEqual(register.balances, {
  workingCents: 8400, clearedCents: 8900, unclearedCents: -500,
});
const second = run('reconcile', cash.id, '--as-of', '2026-10-10',
  '--bank-balance', '89.00', '--confirm').reconciliation;
assert.notEqual(second.id, first.id);
assert.equal(second.status, 'valid');
checks = run('reconciliation', 'list', '--account', cash.id).reconciliations;
assert.equal(checks.length, 2);
assert.equal(checks.find(check => check.id === first.id).status, 'needs-review');
assert.equal(checks.find(check => check.id === second.id).entries[0].cents, -1100);
register = run('register', cash.id);
assert.equal(register.entries.find(entry => entry.id === posted.id).clearance, 'reconciled');
assert.equal(register.entries.find(entry => entry.id === pending.id).clearance, 'uncleared');

// Tracking uses a dated observation, separate from cash activity.
const tracking = run('account', 'add', '--name', 'Synthetic Tracking',
  '--kind', 'tracking', '--confirm').account;
const snapshot = run('snapshot', 'add', '--account', tracking.id,
  '--as-of', '2026-10-16', '--balance', '5200.00', '--confirm').snapshot;
assert.equal(snapshot.balanceCents, 520000);
assert.equal(snapshot.source, 'manual');
assert.equal(run('snapshot', 'list', '--account', tracking.id).snapshots[0].id, snapshot.id);
run('account', 'show', tracking.id);

// Copy to new paths and compare all public account/register/check/snapshot views.
const accountsBefore = run('account', 'list');
const trackingBefore = run('account', 'show', tracking.id);
const snapshotsBefore = run('snapshot', 'list', '--account', tracking.id);
const backupResult = execute(['backup', '--db', database, '--to', backup, '--confirm', '--json']);
assert.equal(backupResult.schemaVersion, 2);
assert.equal(backupResult.migrationNeeded, false);
const restoreResult = execute(['restore', '--from', backup, '--to', restored, '--confirm', '--json']);
assert.equal(restoreResult.schemaVersion, 2);
assert.equal(restoreResult.migrationNeeded, false);
assert.deepEqual(copyView('account', 'list'), accountsBefore);
assert.deepEqual(copyView('account', 'show', tracking.id), trackingBefore);
assert.deepEqual(copyView('register', cash.id), register);
assert.deepEqual(copyView('reconciliation', 'list', '--account', cash.id).reconciliations, checks);
assert.deepEqual(copyView('snapshot', 'list', '--account', tracking.id), snapshotsBefore);
execute(['restore', '--from', backup, '--to', restored, '--confirm', '--json'], 2);
assert.deepEqual(copyView('register', cash.id), register);
assert.deepEqual(run('register', cash.id), register);
assert.deepEqual(run('account', 'list'), accountsBefore);
assert.deepEqual(run('reconciliation', 'list', '--account', cash.id).reconciliations, checks);
assert.deepEqual(run('snapshot', 'list', '--account', tracking.id), snapshotsBefore);
console.log('\nPASS: create, entries, mismatch, reconcile, correction, review, recheck, snapshot, backup, restore.');
console.log(`Keep these synthetic demo files for review: ${directory}`);
NODE
)
```

Expected visible results:

| Step | Expected result |
| --- | --- |
| Opening and two purchases | USD 100.00 opening; working 85.00; cleared 90.00; uncleared -5.00 |
| Bank balance 91.00 | Exit 4; difference shown; no reconciliation or adjustment saved |
| Bank balance 90.00 | A valid check; pending purchase stays uncleared |
| Correct posted purchase to -11.00 | Working 84.00; cleared 89.00; original check `needs-review`; original evidence remains -10.00 |
| Bank balance 89.00 | New valid check; original check stays `needs-review`; posted purchase is reconciled |
| Tracking snapshot | Last known USD 5200.00 on 2026-10-16, source `manual` |
| Backup and restore | Schema 2; `migrationNeeded: false`; restored public views equal source views |
| Restore to the same target again | Exit 2; existing destination preserved |

## Check terminal confirmation and cancellation

Use a real terminal. Do not pipe answers: confirmation requires a terminal. This block creates a separate temporary database. It omits `--confirm` on purpose. At `Apply this change? [yes/no] (or cancel):`, enter `no`. Expected exit: 0. The final account list must be empty. This block does not stop your terminal on a command error.

```bash
(
  set -eu
  INAB_CANCEL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/inab-slice-1-cancel.XXXXXX")
  INAB_CLI=/Users/sweiss/code/inab/dist/cli/main.js
  cd "$INAB_CANCEL_DIR"
  echo "Cancellation files: $INAB_CANCEL_DIR"
  node "$INAB_CLI" --db "$INAB_CANCEL_DIR/plan.sqlite" init --confirm --json
  node "$INAB_CLI" --db "$INAB_CANCEL_DIR/plan.sqlite" account add --name "Synthetic cancel" --kind cash --opening 100.00 --as-of 2026-10-01 --json
  echo "Cancellation exit: $? (expected 0)"
  node "$INAB_CLI" --db "$INAB_CANCEL_DIR/plan.sqlite" account list --json
)
```

Repeat with a fresh directory to try `cancel` at the confirmation prompt. Expected result: exit 0 and no account. Press Ctrl+C at the confirmation prompt to cancel. Expected result: exit 0 and no account, as with `no`. To test a confirmed write, repeat in another fresh directory and enter `yes`; the account list then has one account. `--confirm` skips that prompt for the complete scripted workflow above.

## Manual review record

- [ ] The build completed.
- [ ] The full workflow printed `PASS` and ended with exit 0.
- [ ] The printed balances and original review evidence match the table.
- [ ] Restored views match the source, including both reconciliation states and Tracking.
- [ ] `no`, `cancel`, and Ctrl+C saved no account and exited 0; `yes` saved one account.
- [ ] Review any issue before using household data or starting Slice 2.

Report your Node version, final exit code, failed step or final `PASS` line, and any unexpected prompt or result. Include synthetic output only. Keep each printed temporary path while you inspect the files. When finished, delete only the demo directories that these blocks created; do not delete a household database.

## Verification scope

The [workflow map](agent/feature_map.json) runs the corresponding account, transaction, reconciliation, correction-review, Tracking, and recovery workflows through the real CLI. Its recovery example uses the same 100.00 opening, -10.00 purchase, and -11.00 correction. The block above combines these workflows and adds a pending purchase and a second reconciliation. The map test does not execute this literal Markdown block.

This complete block was also run separately against `dist/cli/main.js` from its new temporary directory on macOS. It passed the listed assertions and expected error exits. The separate terminal block was run in a real terminal with `no`, `cancel`, Ctrl+C, and `yes`; all exited 0, with empty lists for cancellation and one account for `yes`. User manual review is still pending. Automated security results and limits are in the [Slice 1 security record](slice-1-security-checks.md). Current changes have not been pushed or run on Linux. Slice 2 has not been planned or started.
