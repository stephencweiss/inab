# Slice 2: Initial YNAB migration design

Date: October 22, 2026
Status: implementation design prepared for user review; independent document review approved it with the implementation plan. Product decisions below are agreed; command names, storage layout, and parser limits are implementation proposals. The described behavior is implemented; automated verification passed locally and user manual review remains pending.

## Authority and scope

The [project design](2026-10-17-inab-design.md), [setup-only decision](../../decisions/2026-10-21-ynab-bootstrap-only.md), [opening-history decision](../../decisions/2026-10-20-import-opening-history.md), and [Tracking decision](../../decisions/2026-10-20-tracking-balance-adjustments.md) own product rules. This document makes those rules executable without reopening them.

Initial setup offers start fresh or migrate from YNAB. Migration requires an empty database with setup incomplete. Confirmation commits both CSVs, new accounts, history, decisions, audit records, and setup completion together. A completed plan cannot accept another YNAB import. A new attempt after completion requires a separate database; preserve the old one.

Pause/resume saves review choices outside the empty database. It does not persist half an import. Active envelope calculations, general manual Tracking commands, Plaid, and merging into established accounts are excluded. Existing manual workflows remain available.

## Source evidence

Local read-only structural inspection on October 22, 2026 found:

- Both files are UTF-8 with a byte order mark. Register dates use `MM/DD/YYYY`; plan months use English `Mon YYYY`.
- Register headers: `Account`, `Flag`, `Date`, `Payee`, `Category Group/Category`, `Category Group`, `Category`, `Memo`, `Outflow`, `Inflow`, `Cleared`.
- Plan headers: `Month`, `Category Group/Category`, `Category Group`, `Category`, `Assigned`, `Activity`, `Available`.
- Register statuses are `Uncleared`, `Cleared`, and `Reconciled`. Currency text uses `$`; signed plan values also use `-$`.
- Complete identical rows, zero movements, blank payees/categories, and quoted multiline fields occur. These are not grounds to drop a row.
- Neither export supplies transaction IDs, split parent IDs, bank posting dates, account class/closed state, or an observed account balance. No explicit split marker was found in the inspected category columns. That does not prove that splits are absent.

These are format facts, not representative financial fixtures or proof of another export's structure. No private row, name, memo, amount, or source file is copied into the repository. Tests create new synthetic data.

## Setup state

Add a singleton setup record with `targetId`, `revision`, state `open | fresh | ynab`, `completedAt`, and `importId`. A database-generated random target identity is metadata, not household content. New empty databases start open. Upgrades with any household data or household audit history become completed fresh installations. Never infer eligibility merely from a missing marker.

Eligibility checks all household tables: accounts, transactions, reconciliations/evidence, snapshots, household changes, and import/history tables. Schema, migration ledger, and the open setup record are permitted. Use the same check during preview and again inside an immediate commit transaction.

`setup fresh --confirm` closes setup even with no accounts. For Slice 1 compatibility, the first confirmed manual account creation in an open database also chooses fresh and closes setup in the same transaction. Its preview states that YNAB migration will become unavailable. Other existing commands cannot create household data while leaving an open eligible target behind. An empty initialized target with no household writes remains eligible. Read-only commands do not close setup.

A migration plan binds to target identity, canonical path, schema version, setup revision, and filesystem device/inode captured with bigint stats and stored as decimal strings. Compare every field before review updates and confirmation. Replacing the target with a byte-identical copy at the same path still invalidates the review. Replacing the file or changing its setup state invalidates the review. Backup/restore preserves completed state. No reset or database deletion command is added.

## Parsing and source identity

Use pinned `csv-parse@7.0.3` through `csv-parse/sync` in the adapter. Its [sync API](https://csv.js.org/parse/api/sync/) and [parser options](https://csv.js.org/parse/options/) support quoted records and BOM handling. Read at most 64 MiB per source, at most 250,000 data records per source, and at most 1 MiB per record. Apply the file byte limit before allocating its contents and enforce the record limit during parsing; reject oversized inputs with a structured error. The installed package is pinned to the inspected version in the lockfile.

Decode UTF-8 strictly. Accept LF/CRLF, an optional BOM, quoted commas, escaped quotes, and multiline text. Reject duplicate/missing/unexpected headers, broken CSV, or inconsistent field counts. Ignore truly empty lines, not records with empty values. Header order may vary; names must match the supported set. No locale/date/currency guessing.

Use source bytes for SHA-256 identity. The source key is `(role, sha256)` and row identity is `(sourceKey, logical data record ordinal)`, starting at 1 after the header. A multiline record consumes one ordinal. Repeated transaction values at different ordinals stay separate. A changed CSV requires a fresh preview before import, not a merge. Store original file bytes locally in import source storage so invalid fields and exact source evidence can be inspected after the original path disappears.

Normalize amounts with string validation and integer cents; use `BigInt` for parsing/checking before safe conversion. Support plain dollar amounts with optional valid thousands separators, and signed plan amounts. Inflow/outflow must be nonnegative and cannot both be nonzero. Net cents = inflow minus outflow. Zero net rows remain historical records even though manual transaction creation rejects zero. Preserve all original fields, including flags and category labels. Parse dates through the existing calendar-date rules after explicit format conversion. Source `Cleared` is a source label, not proof of a bank posting date or an INAB reconciliation.

Malformed CSV structure blocks preview. Field-invalid records get an error disposition and source location; full-history import cannot commit until corrected exports produce a new preview. Do not offer silent row omission as a successful full migration. Report source totals as unavailable where invalid amounts make them unknowable.

## Review file and terminal contract

Create a versioned private JSON file, outside the checkout, with mode 0600 and private new directories. Require a new path for initial preview. Reject symlink endpoints and paths that alias a source file or database. Bound JSON to 64 MiB. Updates use atomic temporary-file replacement and an expected review revision; serialize updates with an exclusive lock file and re-read the expected revision under the lock. A crash leaves the prior complete review usable. A stale lock reports its path for inspection; no automatic lock stealing.

The file contains this complete envelope; unresolved values are `null` or tagged decisions, never omitted:

```ts
type ReviewEnvelope = {
  version: 1;
  reviewId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  target: {
    id: string;
    path: string;
    schemaVersion: number;
    setupRevision: number;
    fileIdentity: { device: string; inode: string };
  };
  sources: {
    register: { path: string; sha256: string; byteLength: number };
    plan: { path: string; sha256: string; byteLength: number };
  };
  decisions: ReviewDecision[];
};
```

`ReviewDecision` is a validated tagged union: account mapping, account opening, row treatment/posting evidence, observation selection, observation review resolution, acknowledged historical ambiguity, or an archived replaced-observation selection (`observation-audit`). Replaced selections preserve original target/row/resolution evidence; a new selection gets a fresh active key and clears stale resolution. Discarded adjustment candidates remain source history but are excluded from active observation arithmetic. Each refers to immutable source keys rather than names as identifiers. Commit holds the review lock through validation and confirmation, preventing concurrent decision updates to the confirmed revision. Proposed local UUIDs are generated once per review and remain stable when it resumes. Parse file JSON and rederive every preview from source bytes and decisions; never trust editable totals, ready flags, or arbitrary database mutations in a file. Every write checks the review revision. Commit confirmation names the exact expected review revision.

Proposed commands, all requiring explicit `--db` except help, and all supporting `--json`:

```text
setup status
setup fresh --confirm
setup migrate preview --register FILE --plan FILE --review FILE
setup migrate review --review FILE
setup migrate account SOURCE_ACCOUNT --review FILE --name NAME --kind cash|credit|tracking --closed yes|no [--new-group] --expected-review N
setup migrate opening SOURCE_ACCOUNT --review FILE --as-of YYYY-MM-DD --balance AMOUNT --expected-review N
setup migrate row ROW_KEY --review FILE --treatment history|pending|posted --expected-review N
setup migrate observation SOURCE_ACCOUNT --review FILE --row ROW_KEY --as-of YYYY-MM-DD --balance AMOUNT --expected-review N
setup migrate resolve OBSERVATION_KEY --review FILE --choice correct-data|revise-adjustment|defer --expected-review N
setup migrate acknowledge ISSUE_KEY --review FILE --expected-review N
setup migrate commit --review FILE --expected-review N --confirm
import history accounts
import history register ACCOUNT_ID --limit N --offset N
import history plan --month YYYY-MM --limit N --offset N
import history report IMPORT_ID
```

Preview creates a stable default group key for each exact source account label. `account SOURCE_ACCOUNT --new-group` creates another group for that source label, returns a new stable group key and proposed local UUID, and does not move any rows automatically. The user assigns rows explicitly with the row command. These keys survive pause/resume. Every nonempty group needs its own class, closed state, and required opening confirmation; reject unused empty groups at commit.

Row decisions can use `--account GROUP_KEY` to explicitly assign a row to a reviewed account group when source names are ambiguous. Every row has exactly one such mapping; never merge indistinguishable names without review. Posted row decisions additionally require `--posted-on YYYY-MM-DD`; pending/history decisions reject that flag. Correction decisions use the row command to correct explicit posting/treatment evidence; they cannot silently rewrite original source amounts. To correct an erroneous exported amount, fix the export and create a fresh preview. Observation selection takes one source-linked row and user-confirmed observed balance; the CSV alone cannot provide the latter. Repeating the observation command for the same account/date is an explicit selection of the retained candidate, replacing the prior active selection while preserving source dispositions. `revise-adjustment` requires an explicit proposed amount in the displayed preview and confirmation of that exact review revision at commit. `defer` retains `needs-review` and creates no new balancing adjustment. It is not a generic permission to skip invalid required account data.

`setup` without a subcommand offers start fresh or migration only in a TTY. It shows status for completed setups. Scripts use the explicit commands above. Cancelling a prompt exits 0 without database or review changes. Mutation prompts confirm target and choices. Scripted review mutations require complete flags and `--expected-review`; `--confirm` is required for database writes. Exit 0 means success/cancellation, 2 invalid input or incomplete review, 3 missing source/target/record, 4 stale/conflicting review or setup closed, 1 unexpected storage failure. JSON errors are structured on stderr; stdout contains only result JSON. Default errors omit private row text.

The `--review` read operation returns account/row/issue keys, source counts, pending decisions, revision, and readiness. It supports guided prompts in a TTY; JSON mode never prompts. Account selectors are stable preview keys so identical/ambiguous names cannot accidentally select the wrong account.

## Account boundaries and historical records

Create all account mappings inside this new setup. A source account name is a grouping label, not permanent external identity. The user confirms class, closed state, and distinct ambiguous groups; never merge names automatically. Cash/Credit require an explicitly confirmed opening amount/date. Tracking can import source history with no balance observation and must then show that no observed balance is available. No sum of historical transactions is labeled as an observed balance.

Keep the full register and monthly plan as source-linked historical records. Imported monthly Assigned, Activity, and Available are reference values, never calculated current balances. Preserve duplicate plan observations as source rows; conflicting values for the same month/group/category are reported and require explicit retained selection or acknowledgment as unresolved history. Acknowledgment does not manufacture a canonical value. Structured group/category pairs are identities; slash-joined labels cannot define uniqueness.

The review shows per-account opening coverage. Source rows not explicitly promoted remain `history`, so they do not alter the live register. This is a safe default requiring acknowledgment of unverified coverage, not a claim that the full history matches bank balances. Rows included in the confirmed opening balance remain history. Post-opening Cash/Credit rows can become live pending or posted entries only by explicit row decisions; require the missing posting evidence for posted entries. Unknown posting remains pending only when the user selects pending treatment; otherwise it remains historical evidence with a warning. Future rows and zero rows cannot be promoted to live transactions. Promoting a blank payee requires a user-provided local payee (`--payee` on the row command); preserve the original blank source field. The importer does not weaken manual transaction validation.

Blank categories are preserved without treating them as errors. Transfer labels and repeated merchant/date/amount values can identify inspection candidates, not proven links. With no split parent IDs, retain row-level allocations for inspection and report missing relationships. Do not invent a parent or pair transfers automatically. If a user confirms a relationship in a future workflow, enforce exact sums and one-to-one identity there. Slice 2 does not add a split reconstruction or transfer matching editor.

## Tracking history and observations

Store imported Tracking transactions and adjustment roles in dedicated historical storage; do not enable general manual Tracking writes or insert them into the Cash/Credit transaction table. Tracking historical views place confirmed posted entries in posting-date order, then source ordinal, with a closing observation after the posted entries on its date. Show unverified/pending entries in a separate section ordered by occurrence date and ordinal; never use occurrence as a substitute posting date. A row's export position is a stable display tiebreaker, not proof of bank order.

A source adjustment is retained once as source activity. Its payee text alone does not establish an observation or observed amount. Require a user-confirmed role and observed balance before linking it to an observation. The observation command refers to an existing source row; it cannot create unrelated manual snapshots. Its row decision is validated as an adjustment role (`--role transaction|adjustment|opening` on the row command). An opening role supplies a reviewed Tracking historical baseline; without it, computed differences are unavailable, not zero. History-only import is permitted with acknowledged missing evidence; it must not claim verified balances.

With confirmed baseline and posting evidence, include posted activity through the effective date, then apply its closing adjustment. An observation stores the target separately from the delta, one retained observation per account/day. Do not add target balance as a transaction or duplicate the referenced source adjustment. One source adjustment row can belong to at most one retained observation, even across different dates. Reject reuse rather than applying its delta twice. Source `Reconciled` labels never create INAB verified reconciliation records.

Review shows any difference between source adjustment and the adjustment needed for the observed target. The user can correct posting/treatment decisions, explicitly revise the active adjustment while preserving the original source value, or defer and retain `needs-review`. Add no second full delta. A zero required delta retains the observation but no live zero transaction. Later confirmed posting changes current history after the cutoff; posting on/before the cutoff flags affected observations. Unknown posting remains unverified. Scope these rules to setup review and imported history; later commands/providers implement their own agreed workflows in later slices.

Existing manual snapshots are preserved by upgrades and are not converted to invented historical transactions. Such populated databases cannot import YNAB. Imported observation values are shown through `import history`, with date/source/review state; do not change existing `latestSnapshot` JSON contracts or pretend a source history total is a manual snapshot.

## Persistence and commit

Add explicit Drizzle schema files for setup, source blobs, account mappings, historical register/plan rows, source-to-live links, Tracking observations/decisions, and import runs. Derive row types from the schema. Use foreign keys, unique source+ordinal constraints, account/date observation uniqueness, integer cents checks (including zero for history), valid enum checks, and a unique completed setup import. List each schema file in `drizzle.config.ts`; generate and review SQL and metadata together.

Separate private file reading/hashing/locking from application operations. Inject parsed source data, clocks, IDs, review files, and storage through application-owned ports. Only `src/bootstrap.ts` composes these adapters. Pure migration rules live under `src/accounts/imports/`, importing that directory, `src/lib/`, and only the existing pure `src/accounts/balances.ts`/`register.ts` modules to reuse canonical live balance validation; application operations can also use existing account rules. Extend boundary checks for that nested pure subtree and adapters without turning off current domain restrictions.

Commit sequence:

1. Read bounded source bytes through file descriptors, hash those exact bytes, and rederive the review. Use those in-memory bytes for storage; do not reopen later and import changed contents. Validate the review revision and target identity.
2. Create a private consistent backup through existing recovery code to a new sibling path. Backup failure prevents import. This backup has the current schema; older-schema upgrade backups remain a separate migration concern.
3. Begin an immediate write transaction. Recheck setup identity/revision, all emptiness predicates, and reviewed decisions. Backup creation and import eligibility are not substitutes for this recheck.
4. Write source blobs, mappings, historical rows, observations, selected live entries, source links, reports, audit records, and completed setup status. Do not nest existing per-command commits.
5. Commit once. Report operation/import ID, setup state, counts, warnings, and backup path. Do not require a final review-file write for database success. If post-commit output fails, query setup status with the operation ID; do not import again.

Two simultaneous confirmations cannot both import. If setup is already completed with the same review/import identity, return the stored result with `reused: true` and no writes; otherwise return setup closed. Editing a leftover review file cannot reopen setup. Database schema metadata may be installed independently, but failures leave household tables and setup completion unchanged.

Reports count every parsed row exactly once by outcome: history-only, linked live entry, observation evidence, or invalid. Relationship warnings are separate attributes, not extra rows. An observation's source row can also represent its adjustment but has one primary disposition. Keep source register net totals, source plan column totals, live balance effects, and generated/revised adjustments separate. Do not sum month-end Available across months as a balance. Paginate history reads (default 100, maximum 1,000), bind filters to the selected import/account, and read each response from one database snapshot.

## Verification and delivery

All tests use synthetic fixtures and new temporary databases. Test parsing, setup completion/refusal, pause/resume with empty tables, source/file tampering, review locking and revision conflicts, row accounting, real duplicate preservation, boundaries, missing evidence, Tracking adjustment examples, atomic failure, concurrency, and complete backup/restore. Preserve existing manual CLI workflows and JSON contracts. Add executable feature-map workflows only when implemented. Keep private file/review fixtures in temporary directories and synthetic source CSVs in `tests/fixtures/ynab/`.

Use the [implementation plan](../plans/2026-10-20-slice-2-ynab-import.md) for exact tasks and commands. Before implementation, review this design and the plan together. Before household migration, run the synthetic demo and report unresolved evidence; no private export is a CI fixture. No claim of historical accounting equivalence or current verified balance follows solely from successful import.
