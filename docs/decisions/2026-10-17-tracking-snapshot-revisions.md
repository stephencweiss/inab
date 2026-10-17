# Tracking snapshot revisions

Status: accepted implementation constraint for Slice 1.

A Tracking snapshot records one manual balance on one effective date. The account/date pair is unique. A same-date add is refused with exit code 4 and the existing snapshot ID and revision. The user must request a versioned correction.

Each snapshot add or correction advances the account revision. Correction also advances the snapshot revision, retains its ID, account, effective date, and manual source, and replaces its observed timestamp. Audit history preserves the original observation.

Confirmation validates the account revision, snapshot revision, and unique date inside an immediate write transaction. The snapshot, account revision, and audit record commit together. A write to another observation or the account invalidates an earlier preview. This bounded rule matches the existing account revision checks and prevents confirmation against a changed account view.

Account list and show each read account values and observations in one database transaction. The greatest effective date selects the last known balance. Insertion order and observed timestamps do not select it. No observations are summed, and no Tracking amount enters a transaction register or reconciliation.
