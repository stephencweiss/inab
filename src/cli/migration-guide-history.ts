import { visibleReviewIssues, reviewIssueDetails, reviewIssueTitle } from "./migration-issues.js";
import type {
  LoadedRow,
  ObservationDecision,
  ReviewedRow,
  ReviewIssue,
} from "../accounts/imports/types.js";
import type { PlanRecord, RegisterRecord } from "../accounts/imports/source-types.js";
import type { MigrationTerm } from "./migration-terms.js";
import type { GuideSession } from "./migration-guide-types.js";
import { reviewAccount, reviewOpening } from "./migration-guide-accounts.js";
import { choice, dateAnswer, historyAction, moneyAnswer, text } from "./migration-questions.js";
import { formatCents } from "./render.js";

function usd(cents: number) {
  return `${cents >= 0 ? "+" : ""}${formatCents(cents)} USD`;
}
function rowLabel(row: ReviewedRow) {
  const posting = row.postedOn === null ? "" : ` | posted ${row.postedOn}`;
  return `${row.source.value?.occurredOn ?? "Unknown date"} | ${row.payee || "No payee"} | ${usd(row.source.value?.cents ?? 0)} | ${row.treatment} | ${row.role}${posting}`;
}
async function numbered(
  session: GuideSession,
  label: string,
  labels: string[],
  topic: MigrationTerm = "source-row",
) {
  labels.forEach((value, index) => session.say(`${index + 1}. ${value}`));
  const selected = await choice(
    session.prompts,
    label,
    [...labels.map((_, index) => String(index + 1)), "back", "save"],
    "abandon",
    topic,
  );
  if (selected === "back") return "back";
  return selected === "save" ? null : Number(selected) - 1;
}
async function editRow(session: GuideSession, row: ReviewedRow) {
  const account = session
    .read()
    .derived.accounts.find((candidate) => candidate.key === row.accountKey);
  if (!account) return false;
  for (;;) {
    session.say("\nSource row:");
    session.say(`${account.name}: ${rowLabel(row)}`);
    const treatment = await rowTreatment(session, row);
    if (treatment === "back") return true;
    if (treatment === "retry") continue;
    if (treatment === "done") return false;
    const postedOn = treatment === "posted" ? await postingDate(session, row) : null;
    const role = await rowRole(session, row, account.kind, treatment);
    if (role === "back") continue;
    const payee = await rowPayee(
      session,
      row,
      treatment !== "history" && account.kind !== "tracking",
    );
    if (payee === null) continue;
    await session.save({
      tag: "row",
      key: row.key,
      accountKey: row.accountKey,
      treatment,
      postedOn,
      role,
      payee,
    });
    return false;
  }
}
async function rowTreatment(
  session: GuideSession,
  row: ReviewedRow,
): Promise<ReviewedRow["treatment"] | "back" | "retry" | "done"> {
  session.say(
    "history keeps source evidence only. pending creates unposted activity. posted requires a bank posting date; source clearing labels do not supply that date.",
  );
  const selected = await choice(
    session.prompts,
    "Row treatment",
    ["history", "pending", "posted", "back"],
    "abandon",
    "row-treatment",
  );
  if (selected === "back") return "back";
  if (selected === "history") return "history";
  if ((row.source.value?.occurredOn ?? "") > session.read().derived.asOfDate)
    return futureTreatment(session);
  return selected === "posted" ? "posted" : "pending";
}
async function futureTreatment(session: GuideSession): Promise<"history" | "retry" | "done"> {
  session.say(
    "This source date is in the future. Future pending or posted activity is blocked. Keep it as history, go back to treatment, or save and return with corrected source evidence.",
  );
  const action = await choice(
    session.prompts,
    "Future source row",
    ["history", "back", "save"],
    "abandon",
    "source-row",
  );
  if (action === "back") return "retry";
  return action === "history" ? "history" : "done";
}

async function rowRole(session: GuideSession, row: ReviewedRow, kind: string, treatment: string) {
  if (kind === "tracking") return trackingRole(session);
  if (treatment === "history") return row.role;
  if (row.role !== "transaction")
    session.say(
      `Active Cash/Credit activity uses transaction role. Saving this change replaces historical ${row.role} role with transaction.`,
    );
  return "transaction" as const;
}
async function rowPayee(session: GuideSession, row: ReviewedRow, required: boolean) {
  if (row.payee || required) return text(session.prompts, "Payee", row.payee || null, "payee");
  const action = await choice(
    session.prompts,
    "Source payee is empty: keep it or edit",
    ["keep", "edit", "back"],
    "abandon",
    "payee",
  );
  if (action === "back") return null;
  return action === "keep" ? "" : text(session.prompts, "Payee", null, "payee");
}
async function postingDate(session: GuideSession, row: ReviewedRow): Promise<string> {
  for (;;) {
    const date = await dateAnswer(
      session.prompts,
      "Bank posting date",
      session.read().derived.asOfDate,
      "posting-date",
    );
    if (date >= (row.source.value?.occurredOn ?? "")) return date;
    session.say("Posting date must be on or after the source date.");
  }
}
async function trackingRole(session: GuideSession): Promise<ReviewedRow["role"] | "back"> {
  session.say(
    "transaction records activity; opening sets the initial Tracking balance; adjustment supports an observed balance.",
  );
  const role = await choice(
    session.prompts,
    "Tracking row role",
    ["transaction", "opening", "adjustment", "back"],
    "abandon",
    "row-role",
  );
  if (role === "opening" || role === "adjustment" || role === "back") return role;
  return "transaction";
}
function sourceRowLabel(source: LoadedRow<RegisterRecord>) {
  if (source.value === null) return originalLabel(source, "register");
  const value = source.value;
  return `${value.account} | ${value.occurredOn} | ${value.payee || "No payee"} | ${usd(value.cents)} | unmapped`;
}
async function unassignedRow(
  session: GuideSession,
  source: LoadedRow<RegisterRecord>,
): Promise<ReviewedRow | "back" | null> {
  const view = session.read();
  const sourceAccount = view.sourceAccounts.find(
    (account) => account.name === source.value?.account,
  );
  const accounts = view.derived.accounts.filter(
    (account) => account.sourceAccount === sourceAccount?.key,
  );
  if (accounts.length === 0) {
    session.say("Missing account mapping. Select accounts to map this source account first.");
    return null;
  }
  const index = await numbered(
    session,
    "Select compatible account for this source row",
    accounts.map((account) => `${account.name} | ${account.kind}`),
    "account-kind",
  );
  if (index === "back") return "back";
  const account = index === null ? null : accounts[index];
  if (!account) return null;
  const saved = view.derived.decisions.find(
    (decision) => decision.tag === "row" && decision.key === source.key,
  );
  return {
    key: source.key,
    source,
    accountKey: account.key,
    treatment: saved?.tag === "row" ? saved.treatment : "history",
    postedOn: saved?.tag === "row" ? saved.postedOn : null,
    payee:
      saved?.tag === "row"
        ? (saved.payee ?? source.value?.payee ?? "")
        : (source.value?.payee ?? ""),
    role: saved?.tag === "row" ? saved.role : "transaction",
    disposition: "history-only",
  };
}
async function selectRow(
  session: GuideSession,
  accountKey: string | null,
): Promise<"back" | "done"> {
  for (;;) {
    session.say("\nSource rows:");
    const view = session.read();
    const sources = view.derived.sourceRegisterRows.filter((source) => {
      if (source.value === null) return false;
      const row = view.derived.rows.find((candidate) => candidate.key === source.key);
      return accountKey === null || row?.accountKey === accountKey;
    });
    if (sources.length === 0) {
      session.say(
        "No valid source rows are available. Correct account mapping or source evidence, then resume review.",
      );
      return "done";
    }
    const index = await numbered(
      session,
      "Select source row",
      sources.map((source) => {
        const row = view.derived.rows.find((candidate) => candidate.key === source.key);
        if (!row) return sourceRowLabel(source);
        const account = view.derived.accounts.find((candidate) => candidate.key === row.accountKey);
        return `${account?.name ?? "Unknown account"} | ${rowLabel(row)}`;
      }),
      "source-row",
    );
    if (index === "back") return "back";
    const source = index === null ? null : sources[index];
    if (!source) return "done";
    const row =
      view.derived.rows.find((candidate) => candidate.key === source.key) ??
      (await unassignedRow(session, source));
    if (row === "back") continue;
    if (row && (await editRow(session, row))) continue;
    return "done";
  }
}

function showHistory(session: GuideSession, accountName: string, warning: ReviewIssue | null) {
  session.say("\nHistory:");
  session.say(`Account: ${accountName}`);
  session.say(
    "Normal migration keeps past transactions as history for inspection. The History action keeps current choices. Use Edit to return any rows you previously made pending or posted to history.",
  );
  session.say(
    "Source history does not prove complete coverage. History-only rows do not change live balances.",
  );
  session.say(
    "history: keep the current row choices and acknowledge unverified history coverage; history-only rows stay outside active balances.",
  );
  session.say("edit: select a source row and change its treatment/evidence.");
  session.say(
    "save: leave this section for the summary without adding an acknowledgement; previously saved choices remain. No import occurs.",
  );
  if (warning)
    session.say(
      warning.blocking
        ? "History coverage needs acknowledgement."
        : "Saved history coverage acknowledgement remains in effect.",
    );
}

export async function reviewHistory(
  session: GuideSession,
  accountKey: string,
  allowBack = false,
): Promise<"continue" | "summary" | "back"> {
  for (;;) {
    const view = session.read();
    const account = view.derived.accounts.find((candidate) => candidate.key === accountKey);
    if (!account) return "continue";
    const warning = view.derived.issues.find((issue) => issue.key === `history:${accountKey}`);
    showHistory(session, account.name, warning ?? null);
    const action = await historyAction(session.prompts, allowBack);
    if (action === "back") return "back";
    if (action === "save") return "summary";
    if (action === "history") {
      if (warning?.blocking) await session.save({ tag: "ack", key: warning.key });
      return "continue";
    }
    await selectRow(session, accountKey);
  }
}

function accountChoices(view: ReturnType<GuideSession["read"]>) {
  const missing = view.sourceAccounts.filter(
    (source) => !view.derived.accounts.some((account) => account.sourceAccount === source.key),
  );
  return [
    ...view.derived.accounts.map((account) => ({
      key: account.key,
      label: `${account.name} | ${account.kind} | ${account.closed ? "closed" : "open"}`,
      kind: account.kind,
      missing: false,
    })),
    ...missing.map((source) => ({
      key: source.key,
      label: `${source.name} | mapping needed`,
      kind: "unmapped",
      missing: true,
    })),
  ];
}
async function selectAccount(session: GuideSession) {
  for (;;) {
    session.say("\nAccounts:");
    const view = session.read();
    const accounts = accountChoices(view);
    const index = await numbered(
      session,
      "Select account to correct",
      accounts.map((account) => account.label),
      "account-kind",
    );
    if (index === "back") return;
    const account = index === null ? null : accounts[index];
    if (!account) return;
    if ((await accountAction(session, account)) === "back") continue;
    return;
  }
}
async function accountAction(
  session: GuideSession,
  account: ReturnType<typeof accountChoices>[number],
) {
  if (account.missing) {
    await reviewAccount(session, account.key);
    return "done";
  }
  const action = await choice(
    session.prompts,
    "Correct account mapping or opening balance",
    account.kind === "tracking"
      ? ["mapping", "back", "save"]
      : ["mapping", "opening", "back", "save"],
    "abandon",
    "account-kind",
  );
  if (action === "back") return "back";
  if (action === "mapping") await reviewAccount(session, account.key);
  if (action === "opening") await reviewOpening(session, account.key);
  return "done";
}

function adjustmentRows(
  view: ReturnType<GuideSession["read"]>,
  accountKey: string,
  existing: ObservationDecision | null,
) {
  return view.derived.rows.filter(
    (row) =>
      row.accountKey === accountKey &&
      row.role === "adjustment" &&
      row.treatment === "posted" &&
      (existing === null || row.postedOn === existing.date),
  );
}
async function addObservation(session: GuideSession, existing: ObservationDecision | null = null) {
  session.say("\nTracking observation evidence:");
  const view = session.read();
  const accounts = view.derived.accounts.filter(
    (account) =>
      account.kind === "tracking" && (existing === null || account.key === existing.accountKey),
  );
  if (accounts.length === 0) {
    session.say("A Tracking account is required for a balance observation.");
    return;
  }
  for (;;) {
    const index = await numbered(
      session,
      "Select Tracking account",
      accounts.map((account) => account.name),
      "observation",
    );
    if (index === "back") return true;
    const account = index === null ? null : accounts[index];
    if (!account) return;
    const rows = adjustmentRows(view, account.key, existing);
    const rowIndex = await adjustmentRowChoice(session, rows);
    if (rowIndex === "back") continue;
    const row = rowIndex === null ? null : rows[rowIndex];
    if (!row) return;
    await saveObservation(session, row, account.key, existing);
    return false;
  }
}
async function adjustmentRowChoice(session: GuideSession, rows: ReviewedRow[]) {
  if (rows.length === 0)
    session.say(
      "Missing evidence: select a source row and explicitly set its treatment to posted, its bank posting date, and its Tracking role to adjustment. Then add the observed balance from external evidence.",
    );
  return numbered(session, "Select posted adjustment evidence", rows.map(rowLabel), "observation");
}
async function saveObservation(
  session: GuideSession,
  row: ReviewedRow,
  accountKey: string,
  existing: ObservationDecision | null,
) {
  const view = session.read();
  let date: string;
  for (;;) {
    date = await dateAnswer(
      session.prompts,
      "Observed balance date; must match the selected adjustment posting date",
      view.derived.asOfDate,
      "observation-date",
    );
    if (date === row.postedOn && (existing === null || date === existing.date)) break;
    session.say(
      `Observation date must match adjustment posting date ${row.postedOn}. Correct the row first if that date is wrong.`,
    );
  }
  const cents = await moneyAnswer(
    session.prompts,
    "Externally observed Tracking balance; assets positive, liabilities negative",
    "observed-balance",
  );
  await session.save({ tag: "observation", accountKey, rowKey: row.key, date, cents });
}
function showObservations(session: GuideSession) {
  session.say("\nTracking observations:");
  const view = session.read();
  view.observations.forEach(({ decision, check }, index) => {
    const account = view.derived.accounts.find(
      (candidate) => candidate.key === decision.accountKey,
    );
    const row = view.derived.rows.find((candidate) => candidate.key === decision.rowKey);
    const difference =
      check.differenceCents === null ? "" : ` | difference ${usd(check.differenceCents)}`;
    const evidence = row ? ` | ${rowLabel(row)}` : " | source row missing";
    session.say(
      `${index + 1}. ${account?.name ?? "Unknown account"} | ${decision.date} | observed ${usd(decision.cents)} | ${check.status} | ${check.reason ?? "balance comparison"}${difference}${evidence}`,
    );
  });
}
async function observations(session: GuideSession): Promise<boolean> {
  for (;;) {
    const view = session.read();
    showObservations(session);
    const action = await choice(
      session.prompts,
      "Tracking observations: add records or replaces explicit dated evidence",
      [...view.observations.map((_, index) => String(index + 1)), "add", "back", "save"],
      "abandon",
      "observation",
    );
    if (action === "save" || action === "back") return false;
    if (action === "add") {
      if (await addObservation(session)) continue;
      return false;
    }
    const observation = view.observations[Number(action) - 1];
    if (!observation) return false;
    const result = await observationAction(session, observation);
    if (result === "back") continue;
    return result;
  }
}
async function observationAction(
  session: GuideSession,
  observation: ReturnType<GuideSession["read"]>["observations"][number],
): Promise<boolean | "back"> {
  for (;;) {
    session.say(
      "correct-data keeps the observation and requires explicit source-row or evidence correction. revise-adjustment applies the computed adjustment only after confirmation. defer leaves the difference unresolved.",
    );
    const resolution = await choice(
      session.prompts,
      "Observation action",
      ["correct-data", "revise-adjustment", "defer", "edit-evidence", "edit-row", "back", "save"],
      "abandon",
      "resolution",
    );
    if (resolution === "back") return "back";
    if (resolution === "save") return false;
    if (resolution === "edit-evidence") {
      session.say(
        "Correcting the selected observation keeps its account and date. Select matching adjustment evidence.",
      );
      if (await addObservation(session, observation.decision)) continue;
      return false;
    }
    if (resolution === "edit-row") {
      if ((await editObservationRow(session, observation.decision.rowKey)) === "back") continue;
      return false;
    }
    return resolveObservation(session, observation, resolution);
  }
}
async function editObservationRow(session: GuideSession, rowKey: string): Promise<"back" | "done"> {
  const row = session.read().derived.rows.find((candidate) => candidate.key === rowKey);
  if (!row) return "done";
  return editEvidenceRow(session, row);
}
async function editEvidenceRow(session: GuideSession, row: ReviewedRow): Promise<"back" | "done"> {
  if (await editRow(session, row)) return selectRow(session, row.accountKey);
  return "done";
}
async function resolveObservation(
  session: GuideSession,
  observation: ReturnType<GuideSession["read"]>["observations"][number],
  resolution: string,
) {
  if (resolution !== "correct-data" && resolution !== "revise-adjustment" && resolution !== "defer")
    return false;
  if (resolution === "revise-adjustment" && observation.check.status === "unverified") {
    session.say(
      "Missing opening or posting evidence. Correct the Tracking rows and observation before revising an adjustment. Save and return with external evidence.",
    );
    return true;
  }
  if (resolution === "revise-adjustment")
    session.say(
      `Computed adjustment: ${usd(observation.check.observedCents - (observation.check.recordedCents ?? 0) + observation.check.adjustmentCents)}. Original source evidence is kept.`,
    );
  await session.save({ tag: "resolve", key: observation.decision.key, choice: resolution });
  return resolution === "defer";
}

function originalLabel<T>(source: LoadedRow<T>, role: string) {
  const fields = Object.entries(source.original)
    .map(([name, value]) => `${name}: ${value}`)
    .join(" | ");
  return `${role} row ${source.ordinal} | ${fields || source.raw || "No source fields available"}`;
}
function monthlyConflicts(rows: LoadedRow<PlanRecord>[]) {
  const groups = new Map<string, LoadedRow<PlanRecord>[]>();
  for (const row of rows) {
    if (row.value === null) continue;
    const value = row.value;
    const key = JSON.stringify([value.month, value.categoryGroup, value.category]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].filter(
    (group) =>
      new Set(
        group.map((row) =>
          JSON.stringify([
            row.value?.assignedCents,
            row.value?.activityCents,
            row.value?.availableCents,
          ]),
        ),
      ).size > 1,
  );
}
function monthlyConflictLabel(view: ReturnType<GuideSession["read"]>, issue: ReviewIssue) {
  const group =
    monthlyConflicts(view.derived.planRows)[Number(issue.key.split(":").at(-1)) - 1] ?? [];
  return group
    .map((row) => {
      const value = row.value;
      if (!value) return originalLabel(row, "plan");
      return `plan row ${row.ordinal} | ${value.month} | ${value.categoryGroup} / ${value.category} | assigned ${usd(value.assignedCents)} | activity ${usd(value.activityCents)} | available ${usd(value.availableCents)}`;
    })
    .join("; ");
}
function issueLabel(view: ReturnType<GuideSession["read"]>, issue: ReviewIssue) {
  const row = view.derived.rows.find((candidate) => candidate.key === issue.rowKey);
  const observation = view.derived.observations.find(
    (candidate) => issue.key === `observation:${candidate.key}`,
  );
  const account = view.derived.accounts.find(
    (candidate) =>
      candidate.key === row?.accountKey ||
      candidate.key === observation?.accountKey ||
      issue.key.endsWith(`:${candidate.key}`),
  );
  const registerSource = view.derived.sourceRegisterRows.find(
    (source) => source.key === issue.rowKey || source.key === issue.key,
  );
  const planSource = view.derived.planRows.find(
    (source) => source.key === issue.rowKey || source.key === issue.key,
  );
  let evidence = "";
  if (row) evidence = rowLabel(row);
  else if (registerSource) evidence = sourceRowLabel(registerSource);
  else if (planSource) evidence = originalLabel(planSource, "plan");
  if (issue.reason === "conflicting-monthly-values") evidence = monthlyConflictLabel(view, issue);
  const detail = evidence === "" ? "" : ` | ${evidence}`;
  return `${issue.blocking ? "Blocked" : "Warning"} | ${account?.name ?? "Source evidence"} | ${reviewIssueTitle(issue)}${detail}`;
}
async function warnings(session: GuideSession) {
  for (;;) {
    session.say("\nWarnings and blockers:");
    const view = session.read();
    const issues = visibleReviewIssues(view);
    const index = await numbered(
      session,
      "Select warning or blocker",
      issues.map((issue) => issueLabel(view, issue)),
      "evidence",
    );
    if (index === "back") return false;
    const issue = index === null ? null : issues[index];
    if (!issue) return false;
    const result = await warningAction(session, issue);
    if (result === "back") continue;
    return result;
  }
}
async function warningAction(session: GuideSession, issue: ReviewIssue): Promise<boolean | "back"> {
  const view = session.read();
  session.say(`\n${reviewIssueTitle(issue)}:\n${reviewIssueDetails(view, issue)}`);
  if (issue.reason === "unverified-history-coverage") {
    const account = view.derived.accounts.find(
      (candidate) => issue.key === `history:${candidate.key}`,
    );
    if (account) {
      const result = await reviewHistory(session, account.key, true);
      if (result === "back") return "back";
      return result === "summary";
    }
    return false;
  }
  if (issue.reason === "conflicting-monthly-values") {
    session.say(
      "The export has different monthly values for the same category. Acknowledgement retains the conflicting values as source history.",
    );
    session.say(monthlyConflictLabel(view, issue));
    const action = await choice(
      session.prompts,
      "Monthly conflict",
      ["acknowledge", "back", "save"],
      "abandon",
      "monthly-conflict",
    );
    if (action === "back") return "back";
    if (action === "acknowledge") await session.save({ tag: "ack", key: issue.key });
    return false;
  }
  const row = view.derived.rows.find((candidate) => candidate.key === issue.rowKey);
  if (row) {
    const result = await editEvidenceRow(session, row);
    return result === "back" ? "back" : false;
  }
  return finishWarning(session, issue);
}

async function finishWarning(session: GuideSession, issue: ReviewIssue) {
  if (issue.blocking) return true;
  return (await choice(
    session.prompts,
    "Warning inspected",
    ["back", "save"],
    "abandon",
    "evidence",
  )) === "back"
    ? "back"
    : true;
}

export async function reviewEvidence(session: GuideSession): Promise<void> {
  for (;;) {
    session.say("\nEvidence review:");
    session.say(
      "Review remaining evidence. Account and row changes require confirmation. Observations require an explicit external balance. Save returns to the summary with existing choices.",
    );
    const action = await choice(
      session.prompts,
      "Evidence review",
      ["accounts", "rows", "observations", "warnings", "back", "save"],
      "abandon",
      "evidence",
    );
    if (action === "save" || action === "back") return;
    if (action === "accounts") await selectAccount(session);
    if (action === "rows") await selectRow(session, null);
    if (action === "observations" && (await observations(session))) return;
    if (action === "warnings" && (await warnings(session))) return;
  }
}
