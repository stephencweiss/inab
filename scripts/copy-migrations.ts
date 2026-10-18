import { cpSync, mkdirSync } from "node:fs";
const target = new URL("../dist/db/migrations/", import.meta.url);
mkdirSync(target, { recursive: true });
cpSync(new URL("../db/migrations/", import.meta.url), target, { recursive: true });
