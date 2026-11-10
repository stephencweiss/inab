import { formatCents } from "./render.js";
import { budgetReviewSummary } from "./budget-review-summary.js";
import type { BudgetReview } from "../bootstrap.js";
import type { BudgetSnapshot, BudgetCoverage } from "../application/budget-ports.js";
import type {
  BudgetFacts,
  BudgetCategory,
  OpeningAccount,
  OpeningCategory,
  BudgetAssignment,
  BudgetEvent,
  BudgetAllocation,
} from "../budget/types.js";
import { parseBudgetFacts } from "../budget/parse.js";
import { checkedSum, parseMoney } from "../lib/money.js";
import { parseDate } from "../lib/date.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled, reviewTerminalPrompts } from "./prompts.js";
import { editBudgetDraft } from "./budget-editor.js";
type ReviewValues = { facts: BudgetFacts; coverage: BudgetCoverage };
type ReviewEditor = (draft: ReviewValues) => Promise<ReviewValues | null>;
class Back extends Error {}
class SavedAnswersEnd extends Error {}
function exitReview(value: string, review: BudgetReview, save: (review: BudgetReview) => void) {
  if (["a", "abandon"].includes(value)) {
    save({
      ...review,
      answers: [],
      answerThroughDate: null,
      draft: null,
      facts: null,
      coverage: null,
      preview: null,
      revision: review.revision + 1,
    });
    process.stderr.write("Review answers cleared. The database is unchanged.\n");
    throw new PromptCancelled();
  }
  if (["q", "quit", "cancel"].includes(value)) throw new PromptCancelled();
}
type Questions = {
  generated: (label: string, value: string) => Promise<string>;
  text: (label: string, help: string) => Promise<string>;
  money: (label: string, help: string) => Promise<number>;
  count: (label: string, help: string) => Promise<number>;
  yes: (label: string, help: string) => Promise<boolean>;
  date: (label: string, help: string) => Promise<string>;
  pick: (label: string, choices: string[], help: string) => Promise<string>;
};
function questions(
  review: BudgetReview,
  prompts: TerminalPrompts,
  save: (review: BudgetReview) => void,
  inspect: ((label: string) => void) | null = null,
) {
  const generated = new Set<number>();
  let current = review,
    cursor = 0;
  function control(value: string, help: string) {
    exitReview(value.toLowerCase(), current, save);
    if (["h", "help"].includes(value.toLowerCase())) {
      process.stderr.write(
        `${help}\nBack returns to the prior answer. Quit keeps saved answers and exits. Abandon clears all review answers and exits.\n`,
      );
      return true;
    }
    if (["b", "back"].includes(value.toLowerCase())) {
      let previous = cursor - 1;
      while (generated.has(previous)) previous--;
      current = {
        ...current,
        answers: current.answers.slice(0, Math.max(previous, 0)),
        revision: current.revision + 1,
        draft: null,
        facts: null,
        coverage: null,
        preview: null,
      };
      save(current);
      throw new Back();
    }
    return false;
  }
  function inspectSaved(label: string, stored: string | null) {
    if (inspect === null) return;
    if (stored === null) throw new SavedAnswersEnd();
    inspect(label);
  }
  function showSaved(label: string, value: string) {
    if (inspect === null) process.stderr.write(`${label}: ${value} (saved)\n`);
  }
  async function input<T>(
    label: string,
    parse: (value: string) => T,
    help: string,
    automatic: string | null = null,
  ): Promise<T> {
    for (;;) {
      const stored = current.answers[cursor] ?? null;
      inspectSaved(label, stored);
      const value =
        stored ?? automatic ?? (await prompts.ask(`${label} (help, back, quit, abandon): `)).trim();
      if (control(value, help)) continue;
      let result: T;
      try {
        result = parse(value);
      } catch (error) {
        if (stored !== null) throw error;
        process.stderr.write(`${error instanceof Error ? error.message : "Invalid value"}\n`);
        continue;
      }
      if (stored === null) {
        const next = {
          ...current,
          answers: [...current.answers, value],
          revision: current.revision + 1,
          draft: null,
          facts: null,
          coverage: null,
          preview: null,
        };
        save(next);
        current = next;
      } else showSaved(label, value);
      cursor++;
      return result;
    }
  }
  const q: Questions = {
    generated: (label, value) => {
      generated.add(cursor);
      return input(
        label,
        (v) => v,
        "This internal ID links category records. Edit the category name to change its display name.",
        value,
      );
    },
    text: (label, help) =>
      input(
        label,
        (v) => {
          if (!v) throw new Error("Enter nonblank text");
          return v;
        },
        `${help}\nEnter nonblank text.`,
      ),
    money: (label, help) =>
      input(
        `${label}; signed USD`,
        (v) => {
          const parsed = parseMoney(v);
          if (!parsed.ok) throw new Error("Invalid USD amount");
          return parsed.value;
        },
        `${help}\nEnter USD with at most two decimal places. Enter 0 for zero; use a minus sign for a negative amount.`,
      ),
    count: (label, help) =>
      input(
        `${label}; whole number`,
        (v) => {
          if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > 10000)
            throw new Error("Enter a whole number from 0 to 10000");
          return Number(v);
        },
        `${help}\nEnter a whole number from 0 to 10000.`,
      ),
    yes: (label, help) =>
      input(
        `${label}; yes/no`,
        (v) => {
          if (!["yes", "y", "no", "n"].includes(v.toLowerCase()))
            throw new Error("Enter yes or no");
          return ["yes", "y"].includes(v.toLowerCase());
        },
        `${help}\nEnter yes or y, or no or n.`,
      ),
    date: (label, help) =>
      input(
        `${label}; YYYY-MM-DD`,
        (v) => {
          const parsed = parseDate(v);
          if (!parsed.ok) throw new Error("Invalid date");
          return parsed.value;
        },
        `${help}\nEnter a calendar date as YYYY-MM-DD.`,
      ),
    pick: (label, choices, help) =>
      input(
        `${label}; ${choices.join(" | ")}`,
        (v) => {
          if (!choices.includes(v)) throw new Error("Select a listed value");
          return v;
        },
        `${help}\nChoose one listed value exactly: ${choices.join(" | ")}.`,
      ),
  };
  return { q, current: () => current };
}
async function categories(q: Questions, snapshot: BudgetSnapshot, reviewId: string) {
  const count = await q.count(
      "Number of budget categories, including card payment reserves",
      "Count spending categories and one payment reserve for each Credit account. Include categories with zero Available.",
    ),
    categories: BudgetCategory[] = [],
    opening: OpeningCategory[] = [];
  for (let i = 0; i < count; i++) {
    const id = await q.generated(
        `Category ${i + 1} internal ID (generated; edit the name on the next line)`,
        `category:${reviewId}:${i + 1}`,
      ),
      name = await q.text(
        `Category ${i + 1} name`,
        "Enter the display name, such as Food. This name can be changed later.",
      ),
      groupId = await q.text(
        `Group name for ${name}`,
        "Enter the group this category belongs to, such as living or cards. Reuse the same group value for related categories.",
      );
    const card = await q.yes(
      `Is ${name} a card payment reserve (cash set aside to pay one Credit account)?`,
      "Choose yes for a category that holds cash for payments to one Credit account. Choose no for a spending category.",
    );
    const cardAccountId = card
      ? await q.pick(
          "Linked Credit account ID",
          snapshot.accounts.filter((a) => a.kind === "credit").map((a) => a.id),
          "Select the Credit account whose payments this category funds. Paste its listed account ID, not a shell variable name.",
        )
      : null;
    const availableCents = await q.money(
        `Opening Available for ${name}`,
        "Enter the funds in this category when the start month begins, after prior-month rollover. Do not include assignments or spending from the start month. A card payment reserve is cash set aside for that card.",
      ),
      evidence = await q.text(
        `Opening balance check note for ${name}`,
        "Describe how you verified this category opening amount, such as a prior-month category balance, a card payment reserve, or a confirmed zero. This records your explanation; it does not attach or read a file.",
      );
    categories.push({ id, name, groupId, cardAccountId, archived: false });
    opening.push({ categoryId: id, availableCents, evidence });
  }
  return { categories, opening };
}
async function allocation(
  q: Questions,
  amountCents: number,
  categories: BudgetCategory[],
): Promise<BudgetAllocation> {
  const kind = await q.pick(
    "Budget treatment",
    ["income", "categories", "unallocated"],
    "Cash income goes to Ready to Assign. A Credit statement credit first reduces debt; only an increase in positive card funds creates assignable money. Categories apply spending or refunds to envelopes. Unallocated leaves the entry for review and prevents activation.",
  );
  if (kind === "income") return { kind: "income" };
  if (kind === "unallocated") return { kind: "unallocated" };
  const count = await q.count(
      "Number of signed category allocation lines",
      "Use one line for a single category, or several for a split. Their signed amounts must total the transaction amount exactly.",
    ),
    lines: { categoryId: string; amountCents: number }[] = [];
  for (let i = 0; i < count; i++)
    lines.push({
      categoryId: await q.pick(
        "Category ID",
        categories.map((c) => c.id),
        "Select the envelope for this activity. Use a spending category for an expense or refund, not a card payment reserve.",
      ),
      amountCents: await q.money(
        `Allocation line ${i + 1}; lines must total ${formatCents(amountCents)} USD`,
        "Enter this category share with the same sign as its activity. Refund lines can be positive. All signed lines must add to the parent transaction exactly.",
      ),
    });
  return { kind: "categories", lines };
}
async function transferPartner(
  q: Questions,
  id: string,
  candidates: BudgetSnapshot["transactions"],
  tracking: BudgetSnapshot["accounts"],
) {
  const existing = candidates.find((t) => t.id === id);
  if (existing) return { id: existing.id, accountId: existing.accountId };
  const account = tracking.find((a) => `tracking:${a.id}` === id);
  if (!account) throw new Error("transfer-leg-unavailable");
  const evidence = await q.text(
    "Unique external Tracking leg evidence ID",
    "Enter a unique reference for the transfer side outside the Cash/Credit register, such as a statement reference. Do not use a pipe character. This does not create a Tracking transaction or change its snapshot.",
  );
  if (evidence.includes("|")) throw new Error("invalid-external-leg-id");
  return { id: evidence, accountId: account.id };
}
async function liveTransfer(
  q: Questions,
  tx: BudgetSnapshot["transactions"][number],
  snapshot: BudgetSnapshot,
  reviewed: Set<string>,
  categories: BudgetCategory[],
  order: number,
): Promise<BudgetEvent> {
  const candidates = snapshot.transactions.filter(
    (other) =>
      other.id !== tx.id &&
      !reviewed.has(other.id) &&
      other.accountId !== tx.accountId &&
      other.cents === -tx.cents &&
      other.occurredOn === tx.occurredOn,
  );
  const tracking = snapshot.accounts.filter((a) => a.kind === "tracking");
  const partnerId = await q.pick(
    "Equal opposite transfer transaction ID, or explicit Tracking endpoint",
    [...candidates.map((t) => t.id), ...tracking.map((a) => `tracking:${a.id}`)],
    "Select the other side of this same transfer. Listed register candidates have equal opposite amounts on the same date; verify their identity before linking. A Tracking endpoint uses separate evidence.",
  );
  const partner = await transferPartner(q, partnerId, candidates, tracking);
  const from = tx.cents < 0 ? tx : partner,
    to = tx.cents < 0 ? partner : tx;
  const categoryId = (await q.yes(
    "Does this transfer need a spending category?",
    "Cash sent to Tracking needs a category. A Tracking inflow can restore a category or go to Ready to Assign without a category. Cash/Cash transfers and card payments have no spending category.",
  ))
    ? await q.pick(
        "Category ID",
        categories.map((c) => c.id),
        "Select the envelope for this activity. Use a spending category for an expense or refund, not a card payment reserve.",
      )
    : null;
  return {
    kind: "transfer",
    id: `reviewed-transfer:${from.id}:${to.id}`,
    sourceId: `transfer|${from.id}|${to.id}`,
    date: tx.occurredOn,
    order,
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
    amountCents: Math.abs(tx.cents),
    categoryId,
  };
}
async function liveEvents(
  q: Questions,
  snapshot: BudgetSnapshot,
  categories: BudgetCategory[],
  startMonth: string,
) {
  const events: BudgetEvent[] = [],
    includedTransactionIds: string[] = [];
  const reviewed = new Set<string>();
  for (const tx of snapshot.transactions) {
    if (reviewed.has(tx.id)) continue;
    const treatment = await q.pick(
      `Transaction ${tx.id}: ${tx.occurredOn}, ${formatCents(tx.cents)} USD; opening includes this amount, activity creates one budget effect`,
      ["opening", "activity", "transfer"],
      "Opening means the amount is already included in the reviewed opening state. Activity gives it one later budget effect. Transfer links it to the other side of the same movement; do not count the legs as purchases.",
    );
    if (treatment === "opening") {
      includedTransactionIds.push(tx.id);
      continue;
    }
    if (treatment === "transfer") {
      const event = await liveTransfer(q, tx, snapshot, reviewed, categories, events.length);
      events.push(event);
      reviewed.add(tx.id);
      for (const id of event.sourceId.split("|").slice(1)) reviewed.add(id);
      continue;
    }
    const date =
      tx.occurredOn < `${startMonth}-01`
        ? await q.pick(
            `Budget effect date for old pending transaction ${tx.id}`,
            [`${startMonth}-01`],
            "This old pending purchase was not included in the opening budget. Review its effect at the start of the active month; clearing later must not spend it again.",
          )
        : tx.occurredOn;
    events.push({
      kind: "transaction",
      id: tx.id,
      sourceId: `live:${tx.id}`,
      date,
      order: events.length,
      accountId: tx.accountId,
      amountCents: tx.cents,
      allocation: await allocation(q, tx.cents, categories),
    });
  }
  return { events, includedTransactionIds };
}
async function historicalTransferSource(
  q: Questions,
  snapshot: BudgetSnapshot,
  event: Extract<BudgetEvent, { kind: "transfer" }>,
) {
  const mode = await q.pick(
    "Historical transfer evidence",
    ["manual", "imported"],
    "Choose imported to link two retained source rows. Choose manual for a transfer verified from other evidence without imported rows.",
  );
  if (mode === "manual") {
    if (event.sourceId.includes("|")) throw new Error("invalid-manual-evidence-id");
    return event.sourceId;
  }
  const from = await historicalSourceLeg(
    q,
    snapshot,
    event.fromAccountId,
    -event.amountCents,
    event.date,
  );
  const to = await historicalSourceLeg(
    q,
    snapshot,
    event.toAccountId,
    event.amountCents,
    event.date,
  );
  return `history|${from}|${to}`;
}
async function historicalSourceLeg(
  q: Questions,
  snapshot: BudgetSnapshot,
  accountId: string,
  cents: number,
  date: string,
) {
  const rows = snapshot.sourceRows
    .filter(
      (r) =>
        r.accountId === accountId &&
        r.cents === cents &&
        r.date === date &&
        r.transactionId === null,
    )
    .map((r) => r.id);
  if (snapshot.accounts.some((a) => a.id === accountId && a.kind === "tracking"))
    rows.push(`external:${accountId}`);
  return q.pick(
    `Historical source leg for ${accountId}, ${formatCents(cents)} USD on ${date}`,
    rows,
    "Select the imported row for this exact transfer leg. The account, signed amount, and date must match. A Tracking side without a row can use its listed external reference.",
  );
}
async function events(
  q: Questions,
  snapshot: BudgetSnapshot,
  categories: BudgetCategory[],
  startMonth: string,
) {
  const { events, includedTransactionIds } = await liveEvents(q, snapshot, categories, startMonth);
  const postedBridgeEventIds: string[] = [];
  if (snapshot.sourceRows.length)
    process.stderr.write(
      `Historical source rows for explicit matching:\n${JSON.stringify(snapshot.sourceRows, null, 2)}\n`,
    );
  const count = await q.count(
    "Number of additional reviewed historical or bridge events",
    "Count budget activity retained outside the live register, including posted activity already covered by a later account opening. Do not add a second copy of a live transaction. Enter 0 if none is needed.",
  );
  for (let i = 0; i < count; i++) {
    const kind = await q.pick(
        `Historical event ${i + 1} kind`,
        ["transaction", "transfer"],
        "Choose transaction for income, spending, or a refund. Choose transfer for money moving between two local accounts.",
      ),
      id = await q.text(
        "Stable event ID",
        "Choose a unique ID for this reviewed historical event. Reuse it when correcting this event later, not for another purchase or transfer.",
      ),
      sourceId = await q.text(
        "Source row ID for a transaction; unique manual evidence ID for a transfer",
        "For an imported transaction, copy its retained source row ID. For manual evidence, enter a unique descriptive reference without pipe characters. The source record is preserved for inspection.",
      ),
      date = await q.date(
        "Budget occurrence date",
        "Use the date this budget activity occurred, rather than its bank posting date. It must be in or after the selected start month and no later than today.",
      ),
      amountCents = await q.money(
        "Signed transaction amount; transfer amount positive",
        "For a transaction, use a negative amount for an outflow and a positive amount for an inflow. For a transfer, enter the positive amount moved between accounts.",
      );
    if (kind === "transaction")
      events.push({
        kind: "transaction",
        id,
        sourceId,
        date,
        order: events.length,
        accountId: await q.pick(
          "Account ID",
          snapshot.accounts.map((a) => a.id),
          "Select the local account for this activity. For transfers, the from account sends money and the to account receives it.",
        ),
        amountCents,
        allocation: await allocation(q, amountCents, categories),
      });
    else {
      const event: Extract<BudgetEvent, { kind: "transfer" }> = {
        kind: "transfer",
        id,
        sourceId,
        date,
        order: events.length,
        fromAccountId: await q.pick(
          "From account ID",
          snapshot.accounts.map((a) => a.id),
          "Select the local account for this activity. For transfers, the from account sends money and the to account receives it.",
        ),
        toAccountId: await q.pick(
          "To account ID",
          snapshot.accounts.map((a) => a.id),
          "Select the local account for this activity. For transfers, the from account sends money and the to account receives it.",
        ),
        amountCents,
        categoryId: (await q.yes(
          "Does this transfer need a spending category?",
          "Cash sent to Tracking needs a category. A Tracking inflow can restore a category or go to Ready to Assign without a category. Cash/Cash transfers and card payments have no spending category.",
        ))
          ? await q.pick(
              "Category ID",
              categories.map((c) => c.id),
              "Select the envelope for this activity. Use a spending category for an expense or refund, not a card payment reserve.",
            )
          : null,
      };
      events.push({ ...event, sourceId: await historicalTransferSource(q, snapshot, event) });
    }
    if (
      await q.yes(
        "Is this a posted bridge event that connects the budget opening to an account opening?",
        "Choose yes only if this posted activity is already covered by the account register opening balance at a later date. It connects the earlier budget balance to that opening without adding the activity to the register twice.",
      )
    )
      postedBridgeEventIds.push(id);
  }
  return { events, includedTransactionIds, postedBridgeEventIds };
}
function printOpeningEquation(
  accounts: OpeningAccount[],
  categories: OpeningCategory[],
  ready: number,
) {
  const held = checkedSum(
    accounts.map((a) => (a.kind === "cash" ? a.balanceCents : Math.max(a.balanceCents, 0))),
  );
  const reserved = checkedSum(categories.map((c) => c.availableCents));
  if (!held.ok || !reserved.ok) {
    process.stderr.write("Opening total exceeds the supported money range.\n");
    return;
  }
  const difference = checkedSum([held.value, -reserved.value, -ready]);
  if (!difference.ok) {
    process.stderr.write("Opening difference exceeds the supported money range.\n");
    return;
  }
  process.stderr.write(
    `Opening check: held funds ${formatCents(held.value)} = category Available ${formatCents(reserved.value)} + Ready to Assign ${formatCents(ready)}. Difference: ${formatCents(difference.value)}.\n`,
  );
}
async function facts(q: Questions, review: BudgetReview, snapshot: BudgetSnapshot, today: string) {
  const firstDay = new Date(`${review.month}-01T00:00:00.000Z`);
  firstDay.setUTCDate(0);
  const boundary = firstDay.toISOString().slice(0, 10);
  const accounts: OpeningAccount[] = [];
  for (const a of snapshot.accounts) {
    if (a.kind === "tracking") continue;
    accounts.push({
      accountId: a.id,
      kind: a.kind,
      closed: await q.yes(
        `Was ${a.name} closed at the budget boundary?`,
        `The budget boundary is ${boundary}, the day before the start month. Choose yes if the financial institution had closed this account by that date. Choose no if it was still open then; its status today can differ.`,
      ),
      balanceCents: await q.money(
        `Boundary closing balance for ${a.name} (${a.id}); before ${review.month}-01`,
        `Enter the verified balance at ${boundary}. Credit debt is negative. Any old pending amount included in the opening must also be included in this reviewed working balance.`,
      ),
      evidence: await q.text(
        "Independent boundary balance evidence",
        `Describe the record you used to verify this account balance at ${boundary}, such as a bank statement or a verified account history. For example: September closing statement. This is a note about your evidence; INAB does not open or attach a file here.`,
      ),
    });
  }
  process.stderr.write(
    `Inspect imported candidates with the same --db path and import history plan --month YYYY-MM. The prior month's Available can support the opening; each elapsed month's Assigned needs a separate review. Imported Activity and Available remain comparison evidence.\n`,
  );
  process.stderr.write(
    "Opening Available is the value after the prior month rollover. Resolve negative ordinary categories before activation. Negative card reserves remain visible. Old pending amounts included in the opening must also be included in the reviewed working balance.\n",
  );
  process.stderr.write(
    "INAB creates category IDs. Choose a category name and a group, such as Housing in Fixed expenses. A card payment reserve is existing cash set aside to pay one Credit account; it is separate from the card debt. Include one reserve category per Credit account.\nA negative Cash account balance or negative Ready to Assign is an opening deficit. Acknowledging it means you accept this starting shortfall; it does not add money or fix the deficit. Choose no when there is no deficit.\nEvidence fields are notes about how you checked a value, such as a statement date or prior plan balance. No file is attached. If you have not checked a value, say so; typing none does not verify it.\n",
  );
  const cats = await categories(q, snapshot, review.id),
    readyToAssignCents = await q.money(
      "Opening Ready to Assign",
      "Enter held funds not already reserved in the opening category balances. Credit debt and Tracking balances do not create assignable funds.",
    ),
    evidence = await q.text(
      "Opening equation evidence",
      "Explain how you checked that opening held funds equal category Available totals plus Ready to Assign, including card reserves. For example: statement balances checked against prior-month category totals.",
    ),
    deficitAcknowledged = await q.yes(
      "Have you reviewed and accepted any opening cash deficit or negative Ready to Assign? Choose no if neither exists",
      "Choose yes only after reviewing an opening Cash deficit or negative Ready to Assign. Choose no when there is no deficit or you have not accepted it. This does not create a balancing adjustment.",
    );
  printOpeningEquation(accounts, cats.opening, readyToAssignCents);
  process.stderr.write(
    "Assigned is the net amount moved into an envelope during the whole month. It is separate from opening Available and spending. For example: opening 100 + Assigned 200 - spending 60 = Available 240. Enter the month's Assigned total, not the amount left.\n",
  );
  const assignments: BudgetAssignment[] = [];
  for (let month = review.month; month <= today.slice(0, 7);) {
    for (const c of cats.categories)
      assignments.push({
        month,
        categoryId: c.id,
        amountCents: await q.money(
          `Reviewed total Assigned in ${month} for ${c.name}; enter 0 explicitly when zero`,
          "Enter the full Assigned total for this category and month, not a change to its opening Available. Use 0 for a confirmed month with no assignments. Imported Assigned values require review before use.",
        ),
      });
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    month = date.toISOString().slice(0, 7);
  }
  const activity = await events(q, snapshot, cats.categories, review.month),
    coverageEvidence = await q.text(
      `Evidence that activity and assignments are complete through ${today}`,
      "Describe how you checked all activity and monthly assignments through today, such as reviewing the register against statements. For a new synthetic plan with no transactions, say so. A note cannot replace missing records.",
    );
  const coverage: BudgetCoverage = {
    throughDate: today,
    evidence: coverageEvidence,
    includedTransactionIds: activity.includedTransactionIds,
    postedBridgeEventIds: activity.postedBridgeEventIds,
  };
  const facts: BudgetFacts = {
    startMonth: review.month,
    currency: "USD",
    opening: {
      accounts,
      categories: cats.opening,
      readyToAssignCents,
      evidence,
      deficitAcknowledged,
    },
    categories: cats.categories,
    assignments,
    events: activity.events,
  };
  const parsed = parseBudgetFacts(facts);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { facts: parsed.value, coverage };
}
async function savedQuestionLabels(review: BudgetReview, snapshot: BudgetSnapshot, today: string) {
  const labels: string[] = [];
  const replay = questions(
    review,
    {
      interactive: true,
      ask: async () => {
        throw new SavedAnswersEnd();
      },
    },
    () => {
      throw new Error("saved-review-replay-write");
    },
    (label) => labels.push(label),
  );
  try {
    await facts(replay.q, review, snapshot, review.answerThroughDate ?? today);
    if (labels.length < review.answers.length) labels.push("Save this completed review?; yes/no");
  } catch (error) {
    if (!(error instanceof SavedAnswersEnd)) throw error;
  }
  return labels;
}
async function answerIndex(
  prompts: TerminalPrompts,
  review: BudgetReview,
  save: (review: BudgetReview) => void,
) {
  const index = (await prompts.ask("Answer number to change; 1 starts again (quit, abandon): "))
    .trim()
    .toLowerCase();
  exitReview(index, review, save);
  if (
    !/^\d+$/.test(index) ||
    Number(index) < 1 ||
    Number(index) > Math.max(1, review.answers.length)
  ) {
    process.stderr.write("Invalid answer number\n");
    return null;
  }
  return Number(index) - 1;
}
async function reviewEditIndex(
  action: string,
  review: BudgetReview,
  prompts: TerminalPrompts,
  labels: string[],
  save: (review: BudgetReview) => void,
) {
  if (action === "back") return Math.max(0, review.answers.length - 1);
  if (action === "edit") {
    process.stderr.write(
      review.answers.map((a, i) => `${i + 1}: ${labels[i] ?? "Saved answer"}: ${a}`).join("\n") +
        "\n",
    );
    return answerIndex(prompts, review, save);
  }
  process.stderr.write("Select continue, edit, back, done, quit, or abandon\n");
  return null;
}
function editsDraft(action: string, review: BudgetReview) {
  const complete = review.draft !== null || (review.facts !== null && review.coverage !== null);
  return action === "edit" && review.answers.length === 0 && complete;
}
function showResumeAdvice(action: string, review: BudgetReview) {
  if (["help", "h"].includes(action)) {
    process.stderr.write(
      "Continue resumes saved choices. Edit lists questions and answers; choose an answer to change and review later choices again. Back changes the last answer. Done or quit keeps progress. Abandon clears all review answers. No choice activates the budget.\n",
    );
    return true;
  }
  if (action === "back" && review.answers.length === 0) {
    process.stderr.write(
      "Use edit to review the JSON draft. There are no saved question answers to step back through.\n",
    );
    return true;
  }
  return false;
}
async function resolveAnswerDate(
  review: BudgetReview,
  prompts: TerminalPrompts,
  today: string,
  save: (review: BudgetReview) => void,
) {
  if (review.answerThroughDate !== null || review.answers.length === 0) return review;
  let date = review.draft?.coverage.throughDate ?? review.coverage?.throughDate ?? null;
  while (date === null) {
    const value = (
      await prompts.ask(
        "Legacy review: through which date did these saved answers apply? YYYY-MM-DD (help, quit, abandon): ",
      )
    ).trim();
    exitReview(value.toLowerCase(), review, save);
    if (["help", "h"].includes(value.toLowerCase())) {
      process.stderr.write(
        "Enter the date you were reviewing through when these answers were saved. INAB needs the original month to match answers to questions. For example, 2026-11-06 for a review through November 6. This does not mark later activity complete.\n",
      );
      continue;
    }
    const parsed = parseDate(value);
    if (!parsed.ok || value > today || value < `${review.month}-01`) {
      process.stderr.write("Enter a valid date from the start month through today.\n");
      continue;
    }
    date = parsed.value;
  }
  const next = { ...review, answerThroughDate: date, revision: review.revision + 1 };
  save(next);
  return next;
}
async function resumeReview(
  review: BudgetReview,
  snapshot: BudgetSnapshot,
  prompts: TerminalPrompts,
  today: string,
  save: (review: BudgetReview) => void,
) {
  if (review.answers.length === 0 && review.facts === null && review.draft === null)
    return { review, done: false };
  for (;;) {
    const action = (
      await prompts.ask("Saved review: continue, edit, back, done, help, quit, or abandon: ")
    )
      .trim()
      .toLowerCase();
    exitReview(action, review, save);
    if (action === "done") return { review, done: true };
    if (showResumeAdvice(action, review)) continue;
    if (!["continue", "edit", "back"].includes(action)) {
      process.stderr.write("Select continue, edit, back, done, quit, or abandon.\n");
      continue;
    }
    review = await resolveAnswerDate(review, prompts, today, save);
    if (action === "continue" || editsDraft(action, review)) return { review, done: false };
    const labels = action === "edit" ? await savedQuestionLabels(review, snapshot, today) : [];
    const keep = await reviewEditIndex(action, review, prompts, labels, save);
    if (keep === null) continue;
    const next = {
      ...review,
      answers: review.answers.slice(0, keep),
      draft: null,
      facts: null,
      coverage: null,
      preview: null,
      revision: review.revision + 1,
    };
    save(next);
    return { review: next, done: false };
  }
}
async function refreshCoverage(
  initial: BudgetReview,
  initialDraft: ReviewValues,
  prompts: TerminalPrompts,
  today: string,
  save: (review: BudgetReview) => void,
) {
  let review = initial;
  let draft = initialDraft;
  const q = questions(
    { ...review, answers: [] },
    {
      ...prompts,
      ask: async (label) => {
        for (;;) {
          const value = await prompts.ask(label);
          exitReview(value.trim().toLowerCase(), review, save);
          if (!["back", "b"].includes(value.trim().toLowerCase())) return value;
          process.stderr.write(
            "To change earlier values, enter quit, then edit the saved review JSON.\n",
          );
        }
      },
    },
    () => {},
  ).q;
  process.stderr.write(
    "Coverage date changed. Check activity and assignments through today. Your opening values and JSON edits are kept.\n",
  );
  for (let month = draft.coverage.throughDate.slice(0, 7); month <= today.slice(0, 7);) {
    for (const category of draft.facts.categories) {
      if (draft.facts.assignments.some((a) => a.month === month && a.categoryId === category.id))
        continue;
      const amountCents = await q.money(
        `Reviewed total Assigned in ${month} for ${category.name}`,
        "Enter the net amount moved into this envelope during the whole month. This is separate from spending and opening Available.",
      );
      draft = {
        ...draft,
        facts: {
          ...draft.facts,
          assignments: [
            ...draft.facts.assignments,
            { month, categoryId: category.id, amountCents },
          ],
        },
      };
      review = {
        ...review,
        draft,
        facts: null,
        coverage: null,
        preview: null,
        revision: review.revision + 1,
      };
      save(review);
    }
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    month = date.toISOString().slice(0, 7);
  }
  const evidence = await q.text(
    `Evidence that activity and assignments are complete through ${today}`,
    "Describe how you checked the activity and assignments through today. For example: register checked against the bank history. This is a note; no file is attached.",
  );
  return {
    review,
    draft: { ...draft, coverage: { ...draft.coverage, throughDate: today, evidence } },
  };
}
async function applyReviewEdit(
  review: BudgetReview,
  draft: ReviewValues,
  editor: ReviewEditor,
  save: (review: BudgetReview) => void,
) {
  let nextDraft: ReviewValues;
  try {
    const edited = await editor(structuredClone(draft));
    if (edited === null) return { review, draft };
    if (edited.facts.startMonth !== review.month) throw new Error("review-month-mismatch");
    if (edited.coverage.throughDate !== draft.coverage.throughDate)
      throw new Error("review-coverage-date-mismatch");
    const parsed = parseBudgetFacts(edited.facts);
    if (!parsed.ok) throw new Error(parsed.reason);
    nextDraft = { ...edited, facts: parsed.value };
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Invalid JSON edit"}\nSaved choices are unchanged. Choose edit to try again.\n`,
    );
    return { review, draft };
  }
  const next = {
    ...review,
    draft: nextDraft,
    answers: [],
    facts: null,
    coverage: null,
    preview: null,
    revision: review.revision + 1,
  };
  save(next);
  return { review: next, draft: nextDraft };
}
async function completedReview(
  initial: BudgetReview,
  values: ReviewValues,
  prompts: TerminalPrompts,
  save: (review: BudgetReview) => void,
  editor: ReviewEditor,
): Promise<BudgetReview> {
  let review = initial;
  let draft = values;
  for (;;) {
    process.stderr.write(
      `Target: ${review.targetPath}\n${budgetReviewSummary(draft.facts, draft.coverage.throughDate)}\n`,
    );
    const action = (
      await prompts.ask("Save this completed review? yes/no/edit (help, quit, abandon): ")
    )
      .trim()
      .toLowerCase();
    exitReview(action, review, save);
    if (["help", "h"].includes(action)) {
      process.stderr.write(
        "Yes saves a completed review for a separate activation preview and commit. No keeps an unfinished draft and exits. Edit opens only the review JSON in Vim. Use :wq to return, or :cq to cancel the edit. Money in JSON is integer cents: 10000 means $100. Quit keeps progress. Abandon clears all review answers.\n",
      );
      continue;
    }
    if (["no", "n"].includes(action)) return review;
    if (["yes", "y"].includes(action)) {
      const next = {
        ...review,
        ...draft,
        draft: null,
        revision: review.revision + 1,
        preview: null,
      };
      save(next);
      return next;
    }
    if (action !== "edit") {
      process.stderr.write("Choose yes, no, or edit.\n");
      continue;
    }
    const edited = await applyReviewEdit(review, draft, editor, save);
    review = edited.review;
    draft = edited.draft;
  }
}
/** Answers are saved after each validated input. Restarting or back reconstructs dependent values. */
export async function guideBudgetActivation(
  initial: BudgetReview,
  snapshot: BudgetSnapshot,
  prompts: TerminalPrompts,
  today: string,
  save: (review: BudgetReview) => void,
  editor: ReviewEditor | null = null,
): Promise<BudgetReview> {
  prompts = reviewTerminalPrompts(prompts);
  process.stderr.write(
    "Review the opening balances, category funds, monthly assignments, and activity through today. Evidence is a note about how you checked a value; no file is attached. Each answer is saved. Enter help at any question for an explanation. Back changes the prior answer. Quit keeps progress; abandon clears all review answers. At the end, edit opens the full JSON in Vim. This review does not activate the budget.\n",
  );
  const resumed = await resumeReview(initial, snapshot, prompts, today, save);
  if (resumed.done) return resumed.review;
  let review: BudgetReview = {
    ...resumed.review,
    answerThroughDate: resumed.review.answerThroughDate ?? today,
  };
  const edit = editor ?? ((draft) => editBudgetDraft(draft, prompts));
  const pending =
    review.draft ??
    (review.facts !== null && review.coverage !== null
      ? { facts: review.facts, coverage: review.coverage }
      : null);
  if (pending !== null) {
    const refreshed =
      pending.coverage.throughDate === today
        ? { review, draft: pending }
        : await refreshCoverage(review, pending, prompts, today, save);
    const next = {
      ...refreshed.review,
      draft: refreshed.draft,
      facts: null,
      coverage: null,
      preview: null,
      revision: refreshed.review.revision + 1,
    };
    save(next);
    return completedReview(next, refreshed.draft, prompts, save, edit);
  }
  for (;;) {
    const guide = questions(review, prompts, (value) => {
      review = value;
      save(value);
    });
    try {
      const values = await facts(guide.q, review, snapshot, review.answerThroughDate ?? today);
      const refreshed =
        values.coverage.throughDate === today
          ? { review: guide.current(), draft: values }
          : await refreshCoverage(guide.current(), values, prompts, today, save);
      const next = {
        ...refreshed.review,
        draft: refreshed.draft,
        facts: null,
        coverage: null,
        preview: null,
        revision: refreshed.review.revision + 1,
      };
      save(next);
      return completedReview(next, refreshed.draft, prompts, save, edit);
    } catch (error) {
      if (error instanceof Back) continue;
      throw error;
    }
  }
}
