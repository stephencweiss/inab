# Manual-account defaults

Date: October 17, 2026
Status: agreed by the user.

Use TypeScript, Node.js, and SQLite from the first terminal version. Use the posted closing balance on the selected date as an account's opening balance. Exclude pending purchases from that balance and record them separately.

Use Uncleared, Cleared, and Reconciled transaction statuses. Compare cleared records with the bank's posted balance. Show differences and resolve their causes; never add a silent adjustment.

The [project design](../superpowers/specs/2026-10-17-inab-design.md) owns the detailed rules. USD was confirmed in the [currency decision](2026-10-17-budget-currency.md). The previously listed Slice 1 defaults are now settled. This decision does not start application implementation.
