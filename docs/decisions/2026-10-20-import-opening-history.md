# Imported history covered by an opening balance

Date: October 20, 2026
Status: agreed by the user during Slice 2 planning.

Keep imported history already covered by a local account’s opening balance available for inspection outside the active register. Preserve source provenance. Do not count this activity again in account balances.

Slice 2 does not move the opening date backward to replay that history. Review must resolve uncertain posting evidence before an imported row can affect the register. An occurrence date alone does not prove whether the opening balance includes the activity.

This decision does not change the existing opening balance or local transaction IDs. It does not define active budget calculations or Tracking snapshot reconstruction.

See the [project design](../superpowers/specs/2026-10-17-inab-design.md) and [Slice 2 plan](../superpowers/plans/2026-10-20-slice-2-ynab-import.md).

Scope update October 21, 2026: YNAB import is [initial setup only](2026-10-21-ynab-bootstrap-only.md). Apply this boundary rule within the new migration plan; it does not authorize merging into established manual accounts.
