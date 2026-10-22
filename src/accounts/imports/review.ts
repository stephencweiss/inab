import { balances } from "../balances.js";
import { orderRegisterEntries } from "../register.js";
import { parseDate } from "../../lib/date.js";
import type {
  LoadedSources,
  ReviewDecision,
  ReviewIssue,
  ReviewedRow,
  ReviewedAccount,
  DerivedReview,
  ObservationDecision,
} from "./types.js";
type IssueSink = (key: string, reason: string, blocking: boolean, rowKey: string | null) => void;
export function sourceAccounts(sources: LoadedSources) {
  const names = [
    ...new Set(
      sources.register.rows.flatMap((row) => (row.value === null ? [] : [row.value.account])),
    ),
  ];
  return names.map((name, index) => ({ key: `account:${index + 1}`, name }));
}
function rowProblem(row: ReviewedRow, account: ReviewedAccount, today: string): string | null {
  const value = row.source.value;
  if (value === null) return "invalid-row";
  if (row.treatment === "history") return row.postedOn === null ? null : "history-posting";
  if (value.occurredOn > today) return "future-date";
  if (row.treatment === "pending" && row.postedOn !== null) return "pending-posting";
  if (row.treatment === "posted" && invalidPosting(row, value.occurredOn, today))
    return "invalid-posting-date";
  if (account.kind === "tracking") return null;
  if (value.cents === 0) return "zero-transaction";
  if (!row.payee.trim()) return "missing-payee";
  if (row.role !== "transaction") return "historical-role-only";
  if (row.postedOn !== null && account.openingDate !== null && row.postedOn <= account.openingDate)
    return "posting-in-opening-period";
  return null;
}
function invalidPosting(row: ReviewedRow, occurredOn: string, today: string) {
  return (
    row.postedOn === null ||
    !parseDate(row.postedOn).ok ||
    row.postedOn < occurredOn ||
    row.postedOn > today
  );
}
function reviewedAccounts(decisions: ReviewDecision[]) {
  return decisions
    .filter((decision) => decision.tag === "account")
    .map((account): ReviewedAccount => {
      const opening = decisions.find(
        (decision) => decision.tag === "opening" && decision.accountKey === account.key,
      );
      return {
        ...account,
        openingDate: opening?.tag === "opening" ? opening.date : null,
        openingCents: opening?.tag === "opening" ? opening.cents : null,
      };
    });
}
function missingOpening(account: ReviewedAccount, today: string) {
  return (
    account.openingDate === null ||
    account.openingCents === null ||
    !parseDate(account.openingDate).ok ||
    account.openingDate > today ||
    !Number.isSafeInteger(account.openingCents)
  );
}
function checkAccounts(
  groups: ReturnType<typeof sourceAccounts>,
  accounts: ReviewedAccount[],
  today: string,
  issue: IssueSink,
) {
  for (const group of groups)
    if (!accounts.some((account) => account.sourceAccount === group.key))
      issue(`mapping:${group.key}`, "missing-account-mapping", true, null);
  for (const account of accounts) {
    if (!groups.some((group) => group.key === account.sourceAccount) || !account.name.trim())
      issue(`mapping:${account.key}`, "invalid-account-mapping", true, null);
    if (account.kind !== "tracking" && missingOpening(account, today))
      issue(`opening:${account.key}`, "missing-opening", true, null);
  }
  if (
    new Set(accounts.map((account) => account.localId)).size !== accounts.length ||
    new Set(accounts.map((account) => account.key)).size !== accounts.length
  )
    issue("accounts", "duplicate-account-identity", true, null);
}
function reviewRow(
  source: LoadedSources["register"]["rows"][number],
  decisions: ReviewDecision[],
  groups: ReturnType<typeof sourceAccounts>,
  accounts: ReviewedAccount[],
  issue: IssueSink,
): ReviewedRow | null {
  if (source.value === null) {
    issue(source.key, source.error ?? "invalid-row", true, source.key);
    return null;
  }
  const name = source.value.account;
  const group = groups.find((candidate) => candidate.name === name);
  const choice = decisions.find(
    (decision) => decision.tag === "row" && decision.key === source.key,
  );
  const selected = choice?.tag === "row" ? choice : null;
  const account = accounts.find(
    (candidate) => candidate.key === (selected?.accountKey ?? group?.key),
  );
  if (!account || account.sourceAccount !== group?.key) {
    issue(source.key, "missing-account-mapping", true, source.key);
    return null;
  }
  const treatment = selected?.treatment ?? "history";
  return {
    key: source.key,
    source,
    accountKey: account.key,
    treatment,
    postedOn: selected?.postedOn ?? null,
    payee: selected?.payee ?? source.value.payee,
    role: selected?.role ?? "transaction",
    disposition:
      account.kind !== "tracking" && treatment !== "history" ? "live-linked" : "history-only",
  };
}
function reviewRows(
  sources: LoadedSources,
  decisions: ReviewDecision[],
  accounts: ReviewedAccount[],
  today: string,
  issue: IssueSink,
) {
  const groups = sourceAccounts(sources);
  const rows: ReviewedRow[] = [];
  for (const source of sources.register.rows) {
    const row = reviewRow(source, decisions, groups, accounts, issue);
    if (row === null) continue;
    const account = accounts.find((candidate) => candidate.key === row.accountKey);
    if (!account) continue;
    if (decisions.some((decision) => decision.tag === "observation" && decision.rowKey === row.key))
      row.disposition = "observation-evidence";
    const problem = rowProblem(row, account, today);
    if (problem !== null) issue(`row:${row.key}`, problem, true, row.key);
    rows.push(row);
  }
  return rows;
}
function acknowledged(decisions: ReviewDecision[], key: string) {
  return decisions.some((decision) => decision.tag === "ack" && decision.key === key);
}
function checkAccountRows(
  accounts: ReviewedAccount[],
  rows: ReviewedRow[],
  decisions: ReviewDecision[],
  issue: IssueSink,
  today: string,
) {
  for (const account of accounts) {
    const own = rows.filter((row) => row.accountKey === account.key);
    if (own.length === 0) issue(`empty:${account.key}`, "empty-account-group", true, null);
    const key = `history:${account.key}`;
    if (own.some((row) => row.treatment === "history"))
      issue(key, "unverified-history-coverage", !acknowledged(decisions, key), null);
    if (account.kind === "tracking") continue;
    if (account.openingCents === null || account.openingDate === null) continue;
    const live = own
      .filter((row) => row.disposition === "live-linked")
      .map((row) => ({
        id: `live:${row.key}`,
        accountId: account.localId,
        occurredOn: row.source.value?.occurredOn ?? "",
        postedOn: row.postedOn,
        cents: row.source.value?.cents ?? 0,
        createdAt: "2000-01-01T00:00:00.000Z",
      }));
    const result = balances(
      {
        id: account.localId,
        name: account.name,
        kind: account.kind,
        currency: "USD",
        openingCents: account.openingCents,
        openingDate: account.openingDate,
      },
      orderRegisterEntries(live),
      today,
    );
    if (!result.ok) issue(`balance:${account.key}`, result.reason, true, null);
  }
}
function invalidObservation(
  observation: ObservationDecision,
  row: ReviewedRow | null,
  account: ReviewedAccount | null,
  today: string,
) {
  if (!account || account.kind !== "tracking" || !row) return true;
  if (row.accountKey !== account.key || row.role !== "adjustment" || row.treatment !== "posted")
    return true;
  return (
    row.postedOn !== observation.date ||
    !Number.isSafeInteger(observation.cents) ||
    !parseDate(observation.date).ok ||
    observation.date > today
  );
}
function checkObservations(
  observations: ObservationDecision[],
  accounts: ReviewedAccount[],
  rows: ReviewedRow[],
  today: string,
  issue: IssueSink,
) {
  const dates = new Set<string>();
  const sourceRows = new Set<string>();
  for (const observation of observations) {
    const row = rows.find((candidate) => candidate.key === observation.rowKey);
    const account = accounts.find((candidate) => candidate.key === observation.accountKey);
    const key = `${observation.accountKey}:${observation.date}`;
    if (dates.has(key) || sourceRows.has(observation.rowKey))
      issue(`observation:${observation.key}`, "duplicate-observation", true, null);
    dates.add(key);
    sourceRows.add(observation.rowKey);
    if (invalidObservation(observation, row ?? null, account ?? null, today))
      issue(`observation:${observation.key}`, "invalid-observation-evidence", true, null);
  }
}
function checkPlan(sources: LoadedSources, decisions: ReviewDecision[], issue: IssueSink) {
  const planValues = new Map<string, Set<string>>();
  for (const row of sources.plan.rows) {
    if (row.value === null) {
      issue(row.key, row.error ?? "invalid-row", true, row.key);
      continue;
    }
    const value = row.value;
    const key = JSON.stringify([value.month, value.categoryGroup, value.category]);
    const values = planValues.get(key) ?? new Set<string>();
    values.add(JSON.stringify([value.assignedCents, value.activityCents, value.availableCents]));
    planValues.set(key, values);
  }
  let conflict = 0;
  for (const values of planValues.values()) {
    if (values.size <= 1) continue;
    conflict++;
    const key = `plan-conflict:${conflict}`;
    issue(key, "conflicting-monthly-values", !acknowledged(decisions, key), null);
  }
}
function decisionIdentity(decision: ReviewDecision) {
  if (decision.tag === "opening") return `${decision.tag}:${decision.accountKey}`;
  return `${decision.tag}:${decision.key}`;
}
function checkDecisions(sources: LoadedSources, decisions: ReviewDecision[], issue: IssueSink) {
  const allKeys = new Set(sources.register.rows.map((row) => row.key));
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (decision.tag === "row" && !allKeys.has(decision.key))
      issue(decision.key, "unknown-source-row", true, null);
    const key = decisionIdentity(decision);
    if (seen.has(key)) issue(key, "duplicate-review-decision", true, null);
    seen.add(key);
  }
}
function checkRelationships(sources: LoadedSources, issue: IssueSink) {
  if (sources.register.rows.length > 0)
    issue("relationships:split-parents", "split-parent-data-unavailable", false, null);
  for (const row of sources.register.rows) {
    if (row.value !== null && /^Transfer\s*:/i.test(row.value.payee))
      issue(`relationship:${row.key}`, "unresolved-transfer", false, row.key);
  }
}
export function deriveReview(
  sources: LoadedSources,
  decisions: ReviewDecision[],
  today: string,
): DerivedReview {
  const issues: ReviewIssue[] = [];
  function issue(key: string, reason: string, blocking: boolean, rowKey: string | null) {
    issues.push({ key, reason, blocking, rowKey });
  }
  const accounts = reviewedAccounts(decisions);
  checkAccounts(sourceAccounts(sources), accounts, today, issue);
  const rows = reviewRows(sources, decisions, accounts, today, issue);
  checkAccountRows(accounts, rows, decisions, issue, today);
  const observations = decisions.filter((decision) => decision.tag === "observation");
  checkObservations(observations, accounts, rows, today, issue);
  checkPlan(sources, decisions, issue);
  checkRelationships(sources, issue);
  checkDecisions(sources, decisions, issue);
  return {
    asOfDate: today,
    ready: !issues.some((entry) => entry.blocking),
    accounts,
    rows,
    sourceRegisterRows: sources.register.rows,
    planRows: sources.plan.rows,
    observations,
    issues,
    decisions,
  };
}
