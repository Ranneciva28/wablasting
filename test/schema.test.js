import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describeSchema as describe } from "../src/schema-describe.js";

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

    // The deploy check passes on a live-like database and fails on drift.
    const verify = (dir) =>
      spawnSync(process.execPath, ["scripts/verify-schema.js"], {
        env: { ...process.env, DATA_DIR: dir },
        encoding: "utf8",
      });
    const ok = verify(fromApp);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /sesuai db\/schema\.sql/);
    const drift = new DatabaseSync(join(fromApp, "app.sqlite"));
    drift.exec("ALTER TABLE contacts ADD COLUMN extra TEXT");
    drift.close();
    const bad = verify(fromApp);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Berbeda: contacts\.columns/);
  } finally {
    await rm(fromApp, { recursive: true, force: true });
    await rm(fromFile, { recursive: true, force: true });
  }
});
