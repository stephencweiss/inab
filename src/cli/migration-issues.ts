import type { ReviewIssue } from "../accounts/imports/types.js";
import type { MigrationView } from "./migration-guide-types.js";

function accountForIssue(view: MigrationView, issue: ReviewIssue) {
  const row = view.derived.rows.find((entry) => entry.key === issue.rowKey);
  return view.derived.accounts.find(
    (account) =>
      account.key === row?.accountKey ||
      ["balance", "history", "opening", "empty"].some(
        (prefix) => issue.key === `${prefix}:${account.key}`,
      ),
  );
}

/** Hides a repeated account balance diagnostic only when its row diagnostic remains visible. */
export function visibleReviewIssues(view: MigrationView) {
  return view.derived.issues.filter((issue) => {
    if (issue.reason !== "posting-in-opening-period" || issue.rowKey !== null) return true;
    const account = accountForIssue(view, issue);
    return !view.derived.issues.some((candidate) => {
      if (candidate.reason !== issue.reason || !candidate.blocking || candidate.rowKey === null)
        return false;
      const row = view.derived.rows.find((entry) => entry.key === candidate.rowKey);
      return account !== undefined && row?.accountKey === account.key;
    });
  });
}

export function reviewIssueTitle(issue: ReviewIssue) {
  if (issue.reason === "posting-in-opening-period") return "Posting date overlaps opening balance";
  if (issue.reason === "unverified-history-coverage") return "History completeness is not verified";
  if (issue.reason === "split-parent-data-unavailable")
    return "Split purchase links are not in the export";
  return issue.reason.replaceAll("-", " ");
}

function openingConflictDetails(view: MigrationView, issue: ReviewIssue) {
  const account = accountForIssue(view, issue);
  const rows = view.derived.rows.filter((row) => {
    if (issue.rowKey !== null) return row.key === issue.rowKey;
    return (
      row.accountKey === account?.key &&
      row.disposition === "live-linked" &&
      row.postedOn !== null &&
      account.openingDate !== null &&
      row.postedOn <= account.openingDate
    );
  });
  const dates = rows
    .map((row) => `${row.payee || "No payee"}: posting date ${row.postedOn}`)
    .join("; ");
  return `Meaning: ${account?.name ?? "This account"}: ${dates || "posting evidence unavailable"}; opening balance date ${account?.openingDate ?? "not available"}. Posting falls on or before the opening date.\nEffect: A transaction would be counted twice if it is already included in that opening balance. Import is blocked.\nAction: Keep affected rows as history if the opening balance covers them. Otherwise correct the opening balance date and amount, or the posting date, using bank evidence. Do not move dates just to clear the blocker.`;
}

export function reviewIssueDetails(view: MigrationView, issue: ReviewIssue) {
  if (issue.reason === "posting-in-opening-period") return openingConflictDetails(view, issue);
  if (issue.reason === "unverified-history-coverage") {
    const action = issue.blocking
      ? "Action: Review the row choices, then confirm History to acknowledge this limit."
      : "Acknowledged: You accepted this limit; the warning remains. No further acknowledgement is required.";
    return `Meaning: The export does not prove complete history for this account.\nEffect: History-only rows remain available for inspection and do not change active balances. Acknowledgement does not prove complete history.\n${action}`;
  }
  if (issue.reason === "split-parent-data-unavailable")
    return "Meaning: A split is one purchase divided across categories. The export does not identify which rows belong to the same purchase.\nEffect: INAB retains the source rows without rebuilding split links. This warning does not prove that your data contains splits.\nAction: No action is required. This export limit does not block import.";
  if (!issue.blocking)
    return `Meaning: ${reviewIssueTitle(issue)}.\nEffect: This warning does not block import. Inspect the source evidence; no acknowledgement is required.`;
  return `Meaning: ${reviewIssueTitle(issue)}.\nAction: Correct the account, row, or observation evidence where available. Invalid source data requires corrected exports and a new preview. Acknowledgement cannot remove this blocker.`;
}

function issueContext(view: MigrationView, issue: ReviewIssue) {
  const account = accountForIssue(view, issue);
  const row = view.derived.rows.find((entry) => entry.key === issue.rowKey);
  return [account?.name, row?.payee, reviewIssueTitle(issue)].filter(Boolean).join(" | ");
}

function alreadyReportedOverlap(view: MigrationView, issue: ReviewIssue) {
  if (issue.reason !== "posting-in-opening-period" || issue.rowKey === null) return false;
  const account = accountForIssue(view, issue);
  const row = view.derived.rows.find((entry) => entry.key === issue.rowKey);
  if (
    !account ||
    !row ||
    row.disposition !== "live-linked" ||
    row.postedOn === null ||
    account.openingDate === null ||
    row.postedOn > account.openingDate
  )
    return false;
  return visibleReviewIssues(view).some(
    (candidate) => candidate.reason === issue.reason && candidate.key === `balance:${account?.key}`,
  );
}

export function reviewIssueChanges(before: MigrationView, after: MigrationView) {
  const previous = visibleReviewIssues(before);
  const current = visibleReviewIssues(after);
  const messages: string[] = [];
  for (const issue of previous) {
    const remaining = after.derived.issues.find(
      (candidate) => candidate.key === issue.key && candidate.reason === issue.reason,
    );
    if (issue.blocking && remaining && !remaining.blocking)
      messages.push(`Acknowledged: ${issueContext(after, remaining)}; warning remains.`);
    else if (!remaining)
      messages.push(
        `${issue.blocking ? "Cleared blocker" : "Warning no longer applies"}: ${issueContext(before, issue)}.`,
      );
  }
  for (const issue of current) {
    const old = before.derived.issues.find(
      (candidate) => candidate.key === issue.key && candidate.reason === issue.reason,
    );
    if (issue.blocking && (!old || !old.blocking) && !alreadyReportedOverlap(before, issue))
      messages.push(`New blocker: ${issueContext(after, issue)}.`);
  }
  return messages;
}
