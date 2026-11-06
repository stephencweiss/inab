import { formatCents } from "./render.js";
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
import { parseMoney } from "../lib/money.js";
import { parseDate } from "../lib/date.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
class Back extends Error {}
type Questions = {
  text: (label: string) => Promise<string>;
  money: (label: string) => Promise<number>;
  count: (label: string) => Promise<number>;
  yes: (label: string) => Promise<boolean>;
  date: (label: string) => Promise<string>;
  pick: (label: string, choices: string[]) => Promise<string>;
};
function questions(
  review: BudgetReview,
  prompts: TerminalPrompts,
  save: (review: BudgetReview) => void,
) {
  let current = review,
    cursor = 0;
  function control(value: string) {
    if (["a", "abandon", "cancel"].includes(value.toLowerCase())) throw new PromptCancelled();
    if (["h", "help"].includes(value.toLowerCase())) {
      process.stderr.write(
        "Enter the reviewed value. Zero must be entered as 0. Balances and assignments use signed USD. Back returns to the prior answer. Abandon keeps saved answers.\n",
      );
      return true;
    }
    if (["b", "back"].includes(value.toLowerCase())) {
      current = {
        ...current,
        answers: current.answers.slice(0, Math.max(cursor - 1, 0)),
        revision: current.revision + 1,
        facts: null,
        coverage: null,
        preview: null,
      };
      save(current);
      throw new Back();
    }
    return false;
  }
  async function input<T>(label: string, parse: (value: string) => T): Promise<T> {
    for (;;) {
      const stored = current.answers[cursor];
      const value = stored ?? (await prompts.ask(`${label} (help, back, abandon): `)).trim();
      if (control(value)) continue;
      let result: T;
      try {
        result = parse(value);
      } catch (error) {
        if (stored !== undefined) throw error;
        process.stderr.write(`${error instanceof Error ? error.message : "Invalid value"}\n`);
        continue;
      }
      if (stored === undefined) {
        const next = {
          ...current,
          answers: [...current.answers, value],
          revision: current.revision + 1,
          facts: null,
          coverage: null,
          preview: null,
        };
        save(next);
        current = next;
      } else process.stderr.write(`${label}: ${value} (saved)\n`);
      cursor++;
      return result;
    }
  }
  const q: Questions = {
    text: (label) =>
      input(label, (v) => {
        if (!v) throw new Error("Enter nonblank text");
        return v;
      }),
    money: (label) =>
      input(`${label}; signed USD`, (v) => {
        const p = parseMoney(v);
        if (!p.ok) throw new Error("Invalid USD amount");
        return p.value;
      }),
    count: (label) =>
      input(`${label}; whole number`, (v) => {
        if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > 10000)
          throw new Error("Enter a whole number from 0 to 10000");
        return Number(v);
      }),
    yes: (label) =>
      input(`${label}; yes/no`, (v) => {
        if (!["yes", "y", "no", "n"].includes(v.toLowerCase())) throw new Error("Enter yes or no");
        return ["yes", "y"].includes(v.toLowerCase());
      }),
    date: (label) =>
      input(`${label}; YYYY-MM-DD`, (v) => {
        const p = parseDate(v);
        if (!p.ok) throw new Error("Invalid date");
        return p.value;
      }),
    pick: (label, choices) =>
      input(`${label}; ${choices.join(" | ")}`, (v) => {
        if (!choices.includes(v)) throw new Error("Select a listed value");
        return v;
      }),
  };
  return { q, current: () => current };
}
async function categories(q: Questions, snapshot: BudgetSnapshot) {
  const count = await q.count("Number of budget categories, including card payment reserves"),
    categories: BudgetCategory[] = [],
    opening: OpeningCategory[] = [];
  for (let i = 0; i < count; i++) {
    const id = await q.text(`Category ${i + 1} stable ID`),
      name = await q.text("Category name"),
      groupId = await q.text("Group name or ID");
    const card = await q.yes("Is this a card payment reserve?");
    const cardAccountId = card
      ? await q.pick(
          "Linked Credit account ID",
          snapshot.accounts.filter((a) => a.kind === "credit").map((a) => a.id),
        )
      : null;
    const availableCents = await q.money(`Opening Available for ${name}`),
      evidence = await q.text("Opening category evidence");
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
  const kind = await q.pick("Budget treatment", ["income", "categories", "unallocated"]);
  if (kind === "income") return { kind: "income" };
  if (kind === "unallocated") return { kind: "unallocated" };
  const count = await q.count("Number of signed category allocation lines"),
    lines: { categoryId: string; amountCents: number }[] = [];
  for (let i = 0; i < count; i++)
    lines.push({
      categoryId: await q.pick(
        "Category ID",
        categories.map((c) => c.id),
      ),
      amountCents: await q.money(
        `Allocation line ${i + 1}; lines must total ${formatCents(amountCents)} USD`,
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
  const evidence = await q.text("Unique external Tracking leg evidence ID");
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
  );
  const partner = await transferPartner(q, partnerId, candidates, tracking);
  const from = tx.cents < 0 ? tx : partner,
    to = tx.cents < 0 ? partner : tx;
  const categoryId = (await q.yes("Does this transfer need a spending category?"))
    ? await q.pick(
        "Category ID",
        categories.map((c) => c.id),
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
        ? await q.pick(`Budget effect date for old pending transaction ${tx.id}`, [
            `${startMonth}-01`,
          ])
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
  const mode = await q.pick("Historical transfer evidence", ["manual", "imported"]);
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
  const count = await q.count("Number of additional reviewed historical or bridge events");
  for (let i = 0; i < count; i++) {
    const kind = await q.pick(`Historical event ${i + 1} kind`, ["transaction", "transfer"]),
      id = await q.text("Stable event ID"),
      sourceId = await q.text(
        "Source row ID for a transaction; unique manual evidence ID for a transfer",
      ),
      date = await q.date("Budget occurrence date"),
      amountCents = await q.money("Signed transaction amount; transfer amount positive");
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
        ),
        toAccountId: await q.pick(
          "To account ID",
          snapshot.accounts.map((a) => a.id),
        ),
        amountCents,
        categoryId: (await q.yes("Does this transfer need a spending category?"))
          ? await q.pick(
              "Category ID",
              categories.map((c) => c.id),
            )
          : null,
      };
      events.push({ ...event, sourceId: await historicalTransferSource(q, snapshot, event) });
    }
    if (
      await q.yes(
        "Is this a posted bridge event that connects the budget opening to an account opening?",
      )
    )
      postedBridgeEventIds.push(id);
  }
  return { events, includedTransactionIds, postedBridgeEventIds };
}
async function facts(q: Questions, review: BudgetReview, snapshot: BudgetSnapshot, today: string) {
  const accounts: OpeningAccount[] = [];
  for (const a of snapshot.accounts) {
    if (a.kind === "tracking") continue;
    accounts.push({
      accountId: a.id,
      kind: a.kind,
      closed: await q.yes(`Was ${a.name} closed at the budget boundary?`),
      balanceCents: await q.money(
        `Boundary closing balance for ${a.name} (${a.id}); before ${review.month}-01`,
      ),
      evidence: await q.text("Independent boundary balance evidence"),
    });
  }
  process.stderr.write(
    `Inspect imported candidates with the same --db path and import history plan --month YYYY-MM. The prior month's Available can support the opening; each elapsed month's Assigned needs a separate review. Imported Activity and Available remain comparison evidence.\n`,
  );
  process.stderr.write(
    "Opening Available is the value after the prior month rollover. Resolve negative ordinary categories before activation. Negative card reserves remain visible. Old pending amounts included in the opening must also be included in the reviewed working balance.\n",
  );
  const cats = await categories(q, snapshot),
    readyToAssignCents = await q.money("Opening Ready to Assign"),
    evidence = await q.text("Opening equation evidence"),
    deficitAcknowledged = await q.yes(
      "Explicitly acknowledge any opening cash deficit or negative Ready to Assign?",
    );
  const assignments: BudgetAssignment[] = [];
  for (let month = review.month; month <= today.slice(0, 7);) {
    for (const c of cats.categories)
      assignments.push({
        month,
        categoryId: c.id,
        amountCents: await q.money(
          `Reviewed total Assigned in ${month} for ${c.name}; enter 0 explicitly when zero`,
        ),
      });
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    month = date.toISOString().slice(0, 7);
  }
  const activity = await events(q, snapshot, cats.categories, review.month),
    coverageEvidence = await q.text(
      `Evidence that activity and assignments are complete through ${today}`,
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
async function answerIndex(prompts: TerminalPrompts, length: number) {
  const index = await prompts.ask("Answer number to change; 1 starts again: ");
  if (!/^\d+$/.test(index) || Number(index) < 1 || Number(index) > Math.max(1, length)) {
    process.stderr.write("Invalid answer number\n");
    return null;
  }
  return Number(index) - 1;
}
async function reviewEditIndex(action: string, review: BudgetReview, prompts: TerminalPrompts) {
  if (action === "back") return Math.max(0, review.answers.length - 1);
  if (action === "edit") {
    process.stderr.write(review.answers.map((a, i) => `${i + 1}: ${a}`).join("\n") + "\n");
    return answerIndex(prompts, review.answers.length);
  }
  process.stderr.write("Select continue, edit, back, or done\n");
  return null;
}
async function resumeReview(
  review: BudgetReview,
  prompts: TerminalPrompts,
  save: (review: BudgetReview) => void,
) {
  if (review.answers.length === 0 && review.facts === null) return { review, done: false };
  for (;;) {
    const action = (
      await prompts.ask("Saved review: continue, edit, back, done, help, or abandon: ")
    )
      .trim()
      .toLowerCase();
    if (["a", "abandon", "cancel"].includes(action)) throw new PromptCancelled();
    if (action === "done") return { review, done: true };
    if (action === "continue") return { review, done: false };
    if (action === "help" || action === "h") {
      process.stderr.write(
        "Continue resumes saved choices. Edit changes a selected answer and reviews all later choices. Back changes the last answer. Done keeps the draft without activation.\n",
      );
      continue;
    }
    const keep = await reviewEditIndex(action, review, prompts);
    if (keep === null) continue;
    const next = {
      ...review,
      answers: review.answers.slice(0, keep),
      facts: null,
      coverage: null,
      preview: null,
      revision: review.revision + 1,
    };
    save(next);
    return { review: next, done: false };
  }
}
/** Answers are saved after each validated input. Restarting or back reconstructs dependent values. */
export async function guideBudgetActivation(
  initial: BudgetReview,
  snapshot: BudgetSnapshot,
  prompts: TerminalPrompts,
  today: string,
  save: (review: BudgetReview) => void,
): Promise<BudgetReview> {
  const resumed = await resumeReview(initial, prompts, save);
  if (resumed.done) return resumed.review;
  let review = resumed.review;
  if (review.coverage !== null && review.coverage.throughDate !== today) {
    review = {
      ...review,
      answers: review.answers.slice(0, Math.max(0, review.answers.length - 2)),
      facts: null,
      coverage: null,
      preview: null,
      revision: review.revision + 1,
    };
    save(review);
    process.stderr.write(
      "Coverage date changed. Review the activity through today and enter fresh coverage evidence.\n",
    );
  }
  for (;;) {
    const guide = questions(review, prompts, (value) => {
      review = value;
      save(value);
    });
    try {
      const values = await facts(guide.q, review, snapshot, today);
      process.stderr.write(
        `Target: ${review.targetPath}\nReviewed opening and activity:\n${JSON.stringify(values, null, 2)}\n`,
      );
      if (
        !(await guide.q.yes(
          "Save this completed review? Activation still requires preview and explicit commit",
        ))
      )
        return guide.current();
      const next = {
        ...guide.current(),
        ...values,
        revision: guide.current().revision + 1,
        preview: null,
      };
      save(next);
      return next;
    } catch (error) {
      if (error instanceof Back) continue;
      throw error;
    }
  }
}
