import { eq } from "drizzle-orm";
import type {
  Reconciliation,
  ReconciliationPreview,
  ReconciliationSession,
  ReconciliationStore,
} from "../application/ports.js";
import { parseDate } from "../lib/date.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import {
  parseAccountRow,
  parseInteger,
  parseManualTransactionRow,
  parseTimestamp,
} from "./rows.js";
import { accounts } from "./schema/accounts.js";
import { transactions } from "./schema/transactions.js";
import { reconciliations, reconciliationEntries } from "./schema/reconciliations.js";
import type { ReconciliationRow, ReconciliationEntryRow } from "./schema/reconciliations.js";
import { changes } from "./schema/changes.js";
type Connection = ReturnType<typeof openDatabase>;
type Queries = Pick<Connection["db"], "select" | "insert" | "update">;
function parseReconciliationRow(row: ReconciliationRow) {
  const parsed = {
    ...row,
    bankCents: parseInteger(row.bankCents),
    computedCents: parseInteger(row.computedCents),
    openingCents: parseInteger(row.openingCents),
    accountRevision: parseInteger(row.accountRevision),
    recordedAt: parseTimestamp(row.recordedAt),
  };
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.accountId !== "string" ||
    !row.accountId ||
    typeof row.cutoffDate !== "string" ||
    !parseDate(row.cutoffDate).ok ||
    typeof row.openingDate !== "string" ||
    !parseDate(row.openingDate).ok ||
    row.cutoffDate < row.openingDate ||
    parsed.accountRevision < 1 ||
    (row.status !== "valid" && row.status !== "needs-review") ||
    typeof row.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(row.recordedAt)) ||
    row.bankCents !== row.computedCents
  )
    throw new Error("Invalid reconciliation row");
  return parsed;
}
function parseEvidenceRow(row: ReconciliationEntryRow) {
  const transactionRevision = parseInteger(row.transactionRevision);
  const cents = parseInteger(row.cents);
  if (
    typeof row.reconciliationId !== "string" ||
    !row.reconciliationId ||
    typeof row.transactionId !== "string" ||
    !row.transactionId ||
    transactionRevision < 1 ||
    cents === 0 ||
    typeof row.postedOn !== "string" ||
    !parseDate(row.postedOn).ok
  )
    throw new Error("Invalid reconciliation evidence");
  return { transactionId: row.transactionId, transactionRevision, cents, postedOn: row.postedOn };
}
export function readReconciliations(db: Queries, id: string): Reconciliation[] {
  return db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.accountId, id))
    .orderBy(reconciliations.cutoffDate, reconciliations.recordedAt, reconciliations.id)
    .all()
    .map((raw) => {
      const row = parseReconciliationRow(raw);
      return {
        ...row,
        differenceCents: 0,
        entries: db
          .select()
          .from(reconciliationEntries)
          .where(eq(reconciliationEntries.reconciliationId, row.id))
          .orderBy(reconciliationEntries.transactionId)
          .all()
          .map(parseEvidenceRow),
      };
    });
}
function save(db: Queries, value: ReconciliationPreview): Reconciliation {
  const { operationId, recordedAt, entries, differenceCents, ...snapshot } = value;
  if (differenceCents !== 0) throw new Error("Reconciliation must match");
  const record = { ...snapshot, id: operationId, status: "valid" as const, recordedAt };
  db.insert(reconciliations).values(record).run();
  for (const entry of entries)
    db.insert(reconciliationEntries)
      .values({ ...entry, reconciliationId: record.id })
      .run();
  const result = { ...record, entries, differenceCents: 0 };
  db.insert(changes)
    .values({
      id: operationId,
      operation: "reconciliation.confirm",
      entityId: record.id,
      beforeJson: null,
      afterJson: JSON.stringify(result),
      recordedAt,
    })
    .run();
  return result;
}
function sessionFor(db: Queries): ReconciliationSession {
  return {
    account: (id) => {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row ? parseAccountRow(row) : null;
    },
    entries: (id) =>
      db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, id))
        .all()
        .map(parseManualTransactionRow),
    reconciliations: (id) => readReconciliations(db, id),
    save: (value) => save(db, value),
  };
}
export function createReconciliationStore(path: string): ReconciliationStore {
  function run<T>(work: (session: ReconciliationSession) => T, write: boolean) {
    const connection = openDatabase(path);
    try {
      const version = validateMigrationHistory(connection.sqlite, migrationsFolder);
      if (version.applied !== version.latest)
        throw new Error("Database schema is out of date. Run db:migrate.");
      return connection.db.transaction((tx) => work(sessionFor(tx)), {
        behavior: write ? "immediate" : "deferred",
      });
    } finally {
      connection.sqlite.close();
    }
  }
  return { read: (work) => run(work, false), write: (work) => run(work, true) };
}
