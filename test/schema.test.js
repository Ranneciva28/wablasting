import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Structural fingerprint of a database: columns, defaults, keys, indexes, checks.
function describe(db) {
  const squash = (sql) =>
    String(sql || "")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const result = {};
  for (const { name, sql } of tables) {
    const indexes = db
      .prepare(`PRAGMA index_list("${name}")`)
      .all()
      .map((i) => ({
        name: i.name.startsWith("sqlite_autoindex") ? "(auto)" : i.name,
        unique: i.unique,
        partial: i.partial,
        columns: db
          .prepare(`PRAGMA index_info("${i.name}")`)
          .all()
          .map((c) => c.name),
        sql: squash(
          db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(i.name)
            ?.sql,
        ),
      }))
      .sort((a, b) =>
        (a.name + a.columns).localeCompare(b.name + b.columns),
      );
    result[name] = {
      columns: db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
      foreignKeys: db
        .prepare(`PRAGMA foreign_key_list("${name}")`)
        .all()
        .map((f) => [f.from, f.table, f.to]),
      indexes,
      checks: squash(sql).match(/check\((?:[^()]|\([^()]*\))*\)/g) || [],
      autoincrement: squash(sql).includes("autoincrement"),
    };
  }
  return result;
}

function migrate(dir) {
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const {db}=await import('./src/store.js');db.close();",
    ],
    {
      env: {
        ...process.env,
        DATA_DIR: dir,
        SESSION_ENCRYPTION_KEY: "cd".repeat(32),
      },
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
}

test("db/schema.sql matches the schema produced by the app's migrations", async () => {
  const fromApp = await mkdtemp(join(tmpdir(), "wablast-schema-app-"));
  const fromFile = await mkdtemp(join(tmpdir(), "wablast-schema-file-"));
  try {
    migrate(fromApp);
    const appDb = new DatabaseSync(join(fromApp, "app.sqlite"));
    const expected = describe(appDb);
    appDb.close();

    const fileDb = new DatabaseSync(join(fromFile, "app.sqlite"));
    fileDb.exec(await readFile("db/schema.sql", "utf8"));
    assert.deepEqual(describe(fileDb), expected);
    fileDb.close();

    // A database created from the file is accepted by the app as-is.
    migrate(fromFile);
    const reopened = new DatabaseSync(join(fromFile, "app.sqlite"));
    try {
      assert.equal(
        reopened.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
        3,
      );
      assert.deepEqual(describe(reopened), expected);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(fromApp, { recursive: true, force: true });
    await rm(fromFile, { recursive: true, force: true });
  }
});
