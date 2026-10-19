# INAB document guide

Status: Slice 1 is implemented and pending user manual review. Next: run the manual demo and review its results and the security record. Slice 2 has not been planned or started.

## Read these first

| Document | Authority |
| --- | --- |
| [Project design](superpowers/specs/2026-10-17-inab-design.md) | Agreed product scope, proposed architecture, and build sequence |
| [Slice 1 manual demo](slice-1-demo.md) | Runnable synthetic workflow, expected results, and user review checklist |
| [Slice 1 security record](slice-1-security-checks.md) | Automated security evidence and current limits |
| [Slice 1 implementation plan](superpowers/plans/2026-10-17-slice-1-manual-accounts.md) | Tasks and checks for manual accounts, reconciliation, Tracking snapshots, and recovery |
| [Budget currency decision](decisions/2026-10-17-budget-currency.md) | Agreed USD budget |
| [Manual-account defaults decision](decisions/2026-10-17-manual-account-defaults.md) | Agreed opening balance and reconciliation defaults |
| [Drizzle and SQLite decision](decisions/2026-10-17-drizzle-sqlite.md) | Agreed ORM, schema types, and migration approach |
| [Migration version authority](decisions/2026-10-17-migration-version-authority.md) | Implementation constraint: validated Drizzle ledger sequence owns schema version |
| [Tracking snapshot revisions](decisions/2026-10-17-tracking-snapshot-revisions.md) | Implementation constraint: atomic account/snapshot revisions and dated last-known views |
| [Recovery version policy](decisions/2026-10-17-recovery-version-policy.md) | Implementation constraint: current-schema recovery, validated private copies, and exclusive new targets |
| [Account workflow map](agent/feature_map.json) | Working terminal account, transaction, reconciliation, correction review, Tracking snapshot, and recovery steps with synthetic execution checks |
| [Verification plan](verification.md) | Required evidence, planned checks, and current enforcement status |
| [Convention adoption decision](decisions/2026-10-17-agent-conventions.md) | Scope and enforcement of INAB agent conventions |
| [Local Git quality decision](decisions/2026-10-18-local-quality-gates.md) | Commit and push checks, revision matching, and remote enforcement limits |

The root README and AGENTS files index working conventions. Future implementation plans describe tasks; they do not redefine product rules. Historical files and external source documents are reference material.

The latest user decision wins. Label each unresolved choice as proposed. A requirement written in a document is not proof that a linter or CI job enforces it.

Change the owning document first, then update affected plans and checks. Avoid copies of the same rule in several documents.
