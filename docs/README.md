# INAB document guide

Status: local accounts and setup migration are implemented. The user reports local migration complete. Slice 3 budget workflows are implemented; manual review is pending. Start with the Slice 3 demo and accounting examples.

## Read these first

| Document | Authority |
| --- | --- |
| [Slice 3 demo](slice-3-demo.md) | Synthetic activation, allocation, card, correction, month, and recovery workflows |
| [Budget examples](budget-examples.md) | Exact synthetic accounting results |
| [CLI JSON output](decisions/2026-11-06-cli-json-output.md) | Accepted terminal indentation and compact pipe/file output |
| [Budget rules](decisions/2026-11-04-envelope-budget-rules.md) | Accepted date, opening, Cash/Credit, reserve, and month rules |
| [Activation review feedback](superpowers/plans/2026-11-06-activation-review-feedback.md) | Eight manual review problems, implemented changes, and verification |
| [Slice 3 progress](superpowers/plans/2026-11-05-slice-3-progress.md) | Implementation evidence and remaining manual review |
| [Slice 3 budget design](superpowers/specs/2026-11-04-slice-3-envelope-budget-design.md) | Approved budget activation, opening evidence, and accounting scope |
| [Slice 3 implementation plan](superpowers/plans/2026-11-04-slice-3-envelope-budget.md) | Ordered implementation tasks and execution status |
| [Project design](superpowers/specs/2026-10-17-inab-design.md) | Agreed product scope, proposed architecture, and build sequence |
| [Slice 1 manual demo](slice-1-demo.md) | Runnable synthetic workflow, expected results, and user review checklist |
| [Slice 1 security record](slice-1-security-checks.md) | Automated security evidence and current limits |
| [Slice 1 implementation plan](superpowers/plans/2026-10-17-slice-1-manual-accounts.md) | Tasks and checks for manual accounts, reconciliation, Tracking snapshots, and recovery |
| [Slice 2 manual demo](slice-2-demo.md) | Runnable synthetic migration, Tracking adjustment review, safe retry, and recovery checks |
| [Slice 2 migration design](superpowers/specs/2026-10-22-slice-2-bootstrap-import-design.md) | Bootstrap-only migration contracts, inspected source limits, and history/evidence rules |
| [Slice 2 import plan](superpowers/plans/2026-10-20-slice-2-ynab-import.md) | Test-first implementation tasks, exact commands, and planned verification |
| [YNAB bootstrap only](decisions/2026-10-21-ynab-bootstrap-only.md) | Agreed initial setup migration, guided review file, and refusal of later imports |
| [Imported opening history](decisions/2026-10-20-import-opening-history.md) | Agreed source inspection outside the active register for history already included in an opening balance |
| [Budget currency decision](decisions/2026-10-17-budget-currency.md) | Agreed USD budget |
| [Manual-account defaults decision](decisions/2026-10-17-manual-account-defaults.md) | Agreed opening balance and reconciliation defaults |
| [Drizzle and SQLite decision](decisions/2026-10-17-drizzle-sqlite.md) | Agreed ORM, schema types, and migration approach |
| [Migration version authority](decisions/2026-10-17-migration-version-authority.md) | Implementation constraint: validated Drizzle ledger sequence owns schema version |
| [Tracking balance adjustments](decisions/2026-10-20-tracking-balance-adjustments.md) | Agreed Tracking transactions and explicit adjustments at balance observations; implementation rules remain open |
| [Tracking snapshot revisions](decisions/2026-10-17-tracking-snapshot-revisions.md) | Implementation constraint: atomic account/snapshot revisions and dated last-known views |
| [Recovery version policy](decisions/2026-10-17-recovery-version-policy.md) | Implementation constraint: current-schema recovery, validated private copies, and exclusive new targets |
| [Account workflow map](agent/feature_map.json) | Working terminal account, transaction, reconciliation, correction review, Tracking snapshot, and recovery steps with synthetic execution checks |
| [Migration term dictionary](term-dictionary.md) | Shared offline definitions used by migration prompt help |
| [Verification plan](verification.md) | Required evidence, planned checks, and current enforcement status |
| [Ideas](ideas.md) | Proposed improvements; not accepted requirements or installed checks |
| [Convention adoption decision](decisions/2026-10-17-agent-conventions.md) | Scope and enforcement of INAB agent conventions |
| [Local Git quality decision](decisions/2026-10-18-local-quality-gates.md) | Commit and push checks, revision matching, and remote enforcement limits |

The root README and AGENTS files index working conventions. Future implementation plans describe tasks; they do not redefine product rules. Historical files and external source documents are reference material.

The latest user decision wins. Label each unresolved choice as proposed. A requirement written in a document is not proof that a linter or CI job enforces it.

Change the owning document first, then update affected plans and checks. Avoid copies of the same rule in several documents.
