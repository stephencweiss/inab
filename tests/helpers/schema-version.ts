import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrationsFolder } from "../../src/storage/migration-history.js";
export const currentSchemaVersion = readMigrationFiles({ migrationsFolder }).length;
