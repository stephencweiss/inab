export type BudgetCategory = {
  id: string;
  groupId: string;
  name: string;
  archived: boolean;
  cardAccountId: string | null;
};
export type OpeningAccount = {
  accountId: string;
  kind: "cash" | "credit";
  balanceCents: number;
  closed: boolean;
  evidence: string;
};
export type OpeningCategory = { categoryId: string; availableCents: number; evidence: string };
export type BudgetOpening = {
  accounts: OpeningAccount[];
  categories: OpeningCategory[];
  readyToAssignCents: number;
  evidence: string;
  deficitAcknowledged: boolean;
};
export type BudgetAssignment = { month: string; categoryId: string; amountCents: number };
export type AllocationLine = { categoryId: string; amountCents: number };
export type BudgetAllocation =
  { kind: "income" } | { kind: "unallocated" } | { kind: "categories"; lines: AllocationLine[] };
export type BudgetTransaction = {
  kind: "transaction";
  id: string;
  sourceId: string;
  date: string;
  order: number;
  accountId: string;
  amountCents: number;
  allocation: BudgetAllocation;
};
export type BudgetTransfer = {
  kind: "transfer";
  id: string;
  sourceId: string;
  date: string;
  order: number;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  categoryId: string | null;
};
export type BudgetEvent = BudgetTransaction | BudgetTransfer;
export type BudgetFacts = {
  startMonth: string;
  currency: "USD";
  opening: BudgetOpening;
  categories: BudgetCategory[];
  assignments: BudgetAssignment[];
  events: BudgetEvent[];
};
export type BudgetFailure = { ok: false; reason: string };
export type BudgetResult<T> = { ok: true; value: T } | BudgetFailure;
export type CategoryMonth = {
  categoryId: string;
  carryInCents: number;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  cashOverspentCents: number;
  creditOverspentCents: number;
};
export type CardMonth = {
  accountId: string;
  balanceCents: number;
  reserveCents: number;
  shortfallCents: number;
};
export type BudgetMonth = {
  month: string;
  readyToAssignCents: number;
  futureAssignedCents: number;
  fundingDeficitCents: number;
  categories: CategoryMonth[];
  cards: CardMonth[];
  heldFundsCents: number;
  complete: boolean;
  unallocatedEventIds: string[];
};
export type BudgetCalculation = { ok: true; months: BudgetMonth[] } | BudgetFailure;
