import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  out: "./db/migrations",
  schema: [
    "./src/storage/schema/accounts.ts",
    "./src/storage/schema/transactions.ts",
    "./src/storage/schema/reconciliations.ts",
    "./src/storage/schema/snapshots.ts",
    "./src/storage/schema/changes.ts",
  ],
});
