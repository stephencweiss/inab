import { checkedSum } from "../lib/money.js";
import { validateAllocations } from "./allocations.js";
import { budgetMonths } from "./months.js";
import { validateOpening } from "./opening.js";
import { validateTransfer } from "./transfers.js";
import type {
  BudgetCalculation,
  BudgetFacts,
  BudgetMonth,
  BudgetTransaction,
  BudgetTransfer,
  CategoryMonth,
  BudgetEvent,
} from "./types.js";

/** All intermediate cents are checked; unsafe arithmetic returns a failure. */
function sum(...amounts: number[]) {
  const result = checkedSum(amounts);
  if (!result.ok) throw new RangeError("unsafe-cents");
  return result.value;
}
function required<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error("invalid-budget-reference");
  return value;
}
function eventFailure(event: BudgetEvent, facts: BudgetFacts) {
  if (event.kind === "transfer") return validateTransfer(event, facts);
  if (event.allocation.kind !== "categories") return { ok: true as const };
  const result = validateAllocations(event.amountCents, event.allocation.lines);
  if (!result.ok) return result;
  if (
    event.allocation.lines.some((l) =>
      facts.categories.some((c) => c.id === l.categoryId && c.cardAccountId !== null),
    )
  )
    return { ok: false as const, reason: "card-reserve-spending-forbidden" };
  return { ok: true as const };
}
export function calculateBudget(facts: BudgetFacts, horizonMonth: string): BudgetCalculation {
  const opening = validateOpening(facts);
  if (!opening.ok) return opening;
  const months = budgetMonths(facts.startMonth, horizonMonth);
  if (!months.ok) return months;
  for (const event of facts.events) {
    const result = eventFailure(event, facts);
    if (!result.ok) return result;
  }
  try {
    const calculation = new Calculation(facts);
    return { ok: true, months: months.value.map((month) => calculation.month(month)) };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: "unsafe-cents" };
    throw error;
  }
}
class Calculation {
  readonly balances: Map<string, number>;
  readonly cash: Set<string>;
  readonly cards: string[];
  readonly cardCategories: Map<string, string>;
  readonly carry: Map<string, number>;
  readonly events: BudgetEvent[];
  readonly unresolved = new Set<string>();
  readonly refundable = new Map<string, { positive: number; debt: number }>();
  ready: number;
  constructor(readonly facts: BudgetFacts) {
    this.balances = new Map(facts.opening.accounts.map((a) => [a.accountId, a.balanceCents]));
    this.cash = new Set(
      facts.opening.accounts.filter((a) => a.kind === "cash").map((a) => a.accountId),
    );
    this.cards = facts.opening.accounts
      .filter((a) => a.kind === "credit")
      .map((a) => a.accountId)
      .sort((a, b) => a.localeCompare(b));
    this.cardCategories = new Map(
      facts.categories.flatMap((c) =>
        c.cardAccountId === null ? [] : [[c.cardAccountId, c.id] as const],
      ),
    );
    this.carry = new Map(facts.opening.categories.map((c) => [c.categoryId, c.availableCents]));
    this.events = [...facts.events].sort(
      (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id),
    );
    this.ready = facts.opening.readyToAssignCents;
  }
  month(month: string): BudgetMonth {
    const calculation = new MonthCalculation(this, month);
    calculation.assign();
    for (const event of this.events.filter((e) => e.date.slice(0, 7) === month))
      calculation.event(event);
    calculation.fundCards();
    const result = calculation.report();
    calculation.rollover();
    return result;
  }
}
class MonthCalculation {
  readonly rows: Map<string, CategoryMonth>;
  readonly cashSpent: Map<string, number>;
  readonly debtSpent: Map<string, Map<string, number>>;
  constructor(
    readonly state: Calculation,
    readonly month: string,
  ) {
    this.rows = new Map(
      state.facts.categories.map((category) => [
        category.id,
        {
          categoryId: category.id,
          carryInCents: required(state.carry, category.id),
          assignedCents: 0,
          activityCents: 0,
          availableCents: required(state.carry, category.id),
          cashOverspentCents: 0,
          creditOverspentCents: 0,
        },
      ]),
    );
    this.cashSpent = new Map(state.facts.categories.map((c) => [c.id, 0]));
    this.debtSpent = new Map(
      state.facts.categories.map((c) => [c.id, new Map(state.cards.map((id) => [id, 0]))]),
    );
  }
  assign() {
    for (const assignment of this.state.facts.assignments.filter((a) => a.month === this.month)) {
      const row = required(this.rows, assignment.categoryId);
      row.assignedCents = sum(row.assignedCents, assignment.amountCents);
      row.availableCents = sum(row.availableCents, assignment.amountCents);
      this.state.ready = sum(this.state.ready, -assignment.amountCents);
    }
  }
  reserveChange(cardId: string, amount: number) {
    const row = required(this.rows, required(this.state.cardCategories, cardId));
    row.activityCents = sum(row.activityCents, amount);
    row.availableCents = sum(row.availableCents, amount);
  }
  categoryActivity(
    categoryId: string,
    amount: number,
    cardId: string | null,
    positiveSpent: number,
  ) {
    const row = required(this.rows, categoryId);
    row.activityCents = sum(row.activityCents, amount);
    row.availableCents = sum(row.availableCents, amount);
    if (cardId === null) {
      this.cashSpent.set(categoryId, sum(required(this.cashSpent, categoryId), -amount));
      return;
    }
    this.cashSpent.set(categoryId, sum(required(this.cashSpent, categoryId), positiveSpent));
    const debt = required(this.debtSpent, categoryId);
    debt.set(cardId, sum(required(debt, cardId), -amount, -positiveSpent));
  }
  event(event: BudgetEvent) {
    if (event.kind === "transfer") this.transfer(event);
    else this.transaction(event);
  }
  transfer(event: BudgetTransfer) {
    const from = this.state.balances.get(event.fromAccountId);
    const to = this.state.balances.get(event.toAccountId);
    if (from !== undefined)
      this.state.balances.set(event.fromAccountId, sum(from, -event.amountCents));
    if (to !== undefined) this.state.balances.set(event.toAccountId, sum(to, event.amountCents));
    if (to !== undefined && this.state.cards.includes(event.toAccountId)) {
      this.reserveChange(event.toAccountId, -event.amountCents);
      this.state.ready = sum(
        this.state.ready,
        Math.max(sum(to, event.amountCents), 0),
        -Math.max(to, 0),
      );
    }
    if (to === undefined && event.categoryId !== null)
      this.categoryActivity(event.categoryId, -event.amountCents, null, 0);
    if (from === undefined) this.externalInflow(event);
  }
  externalInflow(event: BudgetTransfer) {
    if (event.categoryId === null) this.state.ready = sum(this.state.ready, event.amountCents);
    else this.categoryActivity(event.categoryId, event.amountCents, null, 0);
  }
  transaction(event: BudgetTransaction) {
    const before = required(this.state.balances, event.accountId);
    const after = sum(before, event.amountCents);
    this.state.balances.set(event.accountId, after);
    if (event.allocation.kind === "unallocated") {
      this.state.unresolved.add(event.id);
      return;
    }
    const isCash = this.state.cash.has(event.accountId);
    if (event.allocation.kind === "income") {
      this.state.ready = sum(
        this.state.ready,
        isCash ? event.amountCents : sum(Math.max(after, 0), -Math.max(before, 0)),
      );
      return;
    }
    const positiveAdjustment = this.allocate(event, before, isCash);
    if (!isCash)
      this.state.ready = sum(
        this.state.ready,
        Math.max(after, 0),
        -Math.max(before, 0),
        positiveAdjustment,
      );
  }
  allocate(event: BudgetTransaction, before: number, isCash: boolean) {
    if (event.allocation.kind !== "categories") return 0;
    let positiveAdjustment = 0;
    let positiveRemaining = isCash ? 0 : Math.max(before, 0);
    for (const line of [...event.allocation.lines].sort((a, b) =>
      a.categoryId.localeCompare(b.categoryId),
    )) {
      const positiveSpent = Math.min(positiveRemaining, Math.max(-line.amountCents, 0));
      positiveRemaining = sum(positiveRemaining, -positiveSpent);
      const positiveAmount = isCash
        ? 0
        : this.refundPortion(line.categoryId, event.accountId, line.amountCents, positiveSpent);
      positiveAdjustment = sum(positiveAdjustment, positiveAmount);
      this.categoryActivity(
        line.categoryId,
        line.amountCents,
        isCash ? null : event.accountId,
        positiveAmount,
      );
    }
    return positiveAdjustment;
  }
  refundPortion(categoryId: string, accountId: string, amount: number, positiveSpent: number) {
    const key = JSON.stringify([categoryId, accountId]);
    const previous = this.state.refundable.get(key) ?? { positive: 0, debt: 0 };
    if (amount < 0) {
      previous.positive = sum(previous.positive, positiveSpent);
      previous.debt = sum(previous.debt, -amount, -positiveSpent);
      this.state.refundable.set(key, previous);
      return positiveSpent;
    }
    const debtRefund = Math.min(amount, previous.debt);
    const positiveRefund = Math.min(sum(amount, -debtRefund), previous.positive);
    previous.debt = sum(previous.debt, -debtRefund);
    previous.positive = sum(previous.positive, -positiveRefund);
    this.state.refundable.set(key, previous);
    return -positiveRefund;
  }
  fundCards() {
    for (const category of this.state.facts.categories.filter((c) => c.cardAccountId === null))
      this.fundCategory(category.id);
  }
  fundCategory(categoryId: string) {
    const row = required(this.rows, categoryId);
    const cashAmount = required(this.cashSpent, categoryId);
    const refunds = sum(
      ...[...required(this.debtSpent, categoryId).values()].map((amount) => Math.max(-amount, 0)),
    );
    let remaining = sum(row.carryInCents, row.assignedCents, refunds, -cashAmount);
    row.cashOverspentCents = Math.max(-remaining, 0);
    remaining = Math.max(remaining, 0);
    for (const cardId of this.state.cards) {
      const spent = required(required(this.debtSpent, categoryId), cardId);
      const funded = spent < 0 ? spent : Math.min(remaining, spent);
      this.reserveChange(cardId, funded);
      if (spent > 0) {
        remaining = sum(remaining, -funded);
        row.creditOverspentCents = sum(row.creditOverspentCents, spent, -funded);
      }
    }
  }
  report(): BudgetMonth {
    const future = this.futureCommitment();
    const held = sum(
      ...[...this.state.balances].map(([id, amount]) =>
        this.state.cash.has(id) ? amount : Math.max(amount, 0),
      ),
    );
    return {
      month: this.month,
      readyToAssignCents: this.state.ready,
      futureAssignedCents: future,
      fundingDeficitCents: Math.max(sum(future, -this.state.ready), 0),
      categories: [...this.rows.values()],
      cards: this.state.cards.map((accountId) => this.cardReport(accountId)),
      heldFundsCents: held,
      complete: this.state.unresolved.size === 0,
      unallocatedEventIds: [...this.state.unresolved].sort((a, b) => a.localeCompare(b)),
    };
  }
  futureCommitment() {
    const monthly = new Map<string, number>();
    for (const assignment of this.state.facts.assignments.filter((a) => a.month > this.month)) {
      monthly.set(
        assignment.month,
        sum(monthly.get(assignment.month) ?? 0, assignment.amountCents),
      );
    }
    let committed = 0;
    let maximum = 0;
    for (const month of [...monthly.keys()].sort((a, b) => a.localeCompare(b))) {
      committed = sum(committed, required(monthly, month));
      maximum = Math.max(maximum, committed);
    }
    return maximum;
  }
  cardReport(accountId: string) {
    const reserve = required(
      this.rows,
      required(this.state.cardCategories, accountId),
    ).availableCents;
    const balance = required(this.state.balances, accountId);
    return {
      accountId,
      balanceCents: balance,
      reserveCents: reserve,
      shortfallCents: Math.max(sum(Math.max(-balance, 0), -reserve), 0),
    };
  }
  rollover() {
    for (const category of this.state.facts.categories) {
      const row = required(this.rows, category.id);
      this.state.carry.set(
        category.id,
        category.cardAccountId === null ? Math.max(row.availableCents, 0) : row.availableCents,
      );
      if (category.cardAccountId === null)
        this.state.ready = sum(this.state.ready, -row.cashOverspentCents);
    }
  }
}
