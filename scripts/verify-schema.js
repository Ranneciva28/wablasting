// Compares the live database with db/schema.sql without modifying it.
// Usage (Docker): docker compose exec -T app node scripts/verify-schema.js
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describeSchema, schemaDifferences } from "../src/schema-describe.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(process.env.DATA_DIR || resolve(root, "data"), "app.sqlite");
if (!existsSync(file)) {
  console.error(`Database tidak ditemukan: ${file}`);
  process.exit(1);
}
const reference = new DatabaseSync(":memory:");
reference.exec(readFileSync(resolve(root, "db/schema.sql"), "utf8"));
const live = new DatabaseSync(file, { readOnly: true });
try {
  const expected = describeSchema(reference);
  const actual = describeSchema(live);
  const differences = schemaDifferences(actual, expected);
  const migrations = live
    .prepare("SELECT COUNT(*) n FROM schema_migrations")
    .get().n;
  const expectedMigrations = reference
    .prepare("SELECT COUNT(*) n FROM schema_migrations")
    .get().n;
  if (migrations !== expectedMigrations)
    differences.push(
      `Versi migrasi ${migrations}, seharusnya ${expectedMigrations}`,
    );
  if (differences.length) {
    console.error("Skema database TIDAK sesuai db/schema.sql:");
    for (const line of differences) console.error(`- ${line}`);
    process.exit(1);
  }
  console.log(
    `Skema database sesuai db/schema.sql (${Object.keys(expected).length} tabel, migrasi versi ${migrations}).`,
  );
} finally {
  live.close();
  reference.close();
}
