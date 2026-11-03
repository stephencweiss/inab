import { and, asc, eq, sql } from "drizzle-orm";
import type {
  ImportHistoryStore,
  HistoricalRegisterRow,
  HistoricalPlanRow,
} from "../application/import-history.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { setupStatusFrom } from "./setup.js";
import { accounts } from "./schema/accounts.js";
import { importRuns } from "./schema/import-sources.js";
import {
  importAccountMappings,
  importRegisterRows,
  importPlanRows,
} from "./schema/import-history.js";
import { importObservations } from "./schema/import-observations.js";
import { parseImportReceipt } from "./imports.js";
type Queries = Pick<ReturnType<typeof openDatabase>["db"], "select" | "update" | "all">;
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}
function parseOriginal(json: string): Record<string, string> {
  const value: unknown = JSON.parse(json);
  if (!isStringRecord(value)) throw new Error("invalid-import-evidence");
  return value;
}
function registerRow(row: typeof importRegisterRows.$inferSelect): HistoricalRegisterRow {
  const { originalJson, ...value } = row;
  return { ...value, original: parseOriginal(originalJson) };
}
function planRow(row: typeof importPlanRows.$inferSelect): HistoricalPlanRow {
  const { originalJson, ...value } = row;
  return { ...value, original: parseOriginal(originalJson) };
}
function page(limit: number, offset: number) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error("invalid-pagination");
}
export function createImportHistoryStore(path: string): ImportHistoryStore {
  function read<T>(work: (db: Queries) => T) {
    const c = openDatabase(path);
    try {
      const history = validateMigrationHistory(c.sqlite, migrationsFolder);
      if (history.applied !== history.latest)
        throw new Error("Database schema is out of date. Run db:migrate.");
      return c.db.transaction((tx) => work(tx));
    } finally {
      c.sqlite.close();
    }
  }
  return {
    accounts: () =>
      read((db) => {
        const marker = setupStatusFrom(db);
        if (marker.state !== "ynab" || marker.importId === null) return [];
        return db
          .select({
            accountId: accounts.id,
            name: accounts.name,
            kind: accounts.kind,
            closed: importAccountMappings.closed,
            importId: importAccountMappings.importId,
            sourceLabel: importAccountMappings.sourceLabel,
            groupKey: importAccountMappings.groupKey,
          })
          .from(importAccountMappings)
          .innerJoin(accounts, eq(accounts.id, importAccountMappings.accountId))
          .where(eq(importAccountMappings.importId, marker.importId))
          .orderBy(asc(importAccountMappings.groupKey))
          .all();
      }),
    register: (accountId, limit, offset) => {
      page(limit, offset);
      return read((db) => {
        const marker = setupStatusFrom(db),
          importId = marker.importId;
        if (marker.state !== "ynab" || importId === null) throw new Error("account-unavailable");
        if (
          !db
            .select()
            .from(importAccountMappings)
            .where(
              and(
                eq(importAccountMappings.importId, importId),
                eq(importAccountMappings.accountId, accountId),
              ),
            )
            .get()
        )
          throw new Error("account-unavailable");
        const rows = db
          .select()
          .from(importRegisterRows)
          .where(
            and(
              eq(importRegisterRows.accountId, accountId),
              eq(importRegisterRows.importId, importId),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${importRegisterRows.postedOn} IS NULL THEN 1 ELSE 0 END`,
            sql`coalesce(${importRegisterRows.postedOn},${importRegisterRows.occurredOn})`,
            asc(importRegisterRows.ordinal),
          )
          .limit(limit)
          .offset(offset)
          .all()
          .map(registerRow);
        const observations = db
          .select()
          .from(importObservations)
          .where(
            and(
              eq(importObservations.accountId, accountId),
              eq(importObservations.importId, importId),
            ),
          )
          .orderBy(asc(importObservations.effectiveDate), asc(importObservations.id))
          .limit(limit)
          .offset(offset)
          .all();
        return {
          accountId,
          limit,
          offset,
          posted: rows.filter((r) => r.postedOn !== null),
          unverified: rows.filter((r) => r.postedOn === null),
          observations,
        };
      });
    },
    plan: (month, limit, offset) => {
      page(limit, offset);
      return read((db) => {
        const marker = setupStatusFrom(db);
        const rows =
          marker.state !== "ynab" || marker.importId === null
            ? []
            : db
                .select()
                .from(importPlanRows)
                .where(
                  and(
                    eq(importPlanRows.importId, marker.importId),
                    eq(importPlanRows.month, month),
                  ),
                )
                .orderBy(asc(importPlanRows.ordinal))
                .limit(limit)
                .offset(offset)
                .all()
                .map(planRow);
        return { month, limit, offset, rows };
      });
    },
    report: (importId) =>
      read((db) => {
        const marker = setupStatusFrom(db);
        if (marker.state !== "ynab" || marker.importId !== importId) return null;
        const row = db.select().from(importRuns).where(eq(importRuns.id, importId)).get();
        return row ? parseImportReceipt(row.receiptJson) : null;
      }),
  };
}
