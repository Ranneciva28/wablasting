import { backup } from "node:sqlite";
import { resolve } from "node:path";
import { db } from "../src/store.js";
const target = process.argv[2];
if (!target)
  throw Error("Usage: npm run backup -- /absolute/path/backup.sqlite");
try {
  await backup(db, resolve(target));
  console.log("Database backup completed");
} finally {
  db.close();
}
