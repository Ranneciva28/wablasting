import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test("legacy v0.1 database migrates idempotently without dropping contacts or campaigns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wablasting-migrate-"));
  const legacy = new DatabaseSync(join(dir, "app.sqlite"));
  legacy.exec(
    `CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT NOT NULL); INSERT INTO users VALUES('legacy','old@example.com','unused'); CREATE TABLE contacts(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,phone TEXT,optin INTEGER DEFAULT 0,UNIQUE(user,phone)); INSERT INTO contacts VALUES('contact','legacy','Existing','628111111111',1); CREATE TABLE campaigns(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,message TEXT,status TEXT DEFAULT 'queued',created INTEGER); INSERT INTO campaigns VALUES('campaign','legacy','Existing','Original content','completed',1);`,
  );
  legacy.close();
  const env = {
    ...process.env,
    DATA_DIR: dir,
    SESSION_ENCRYPTION_KEY: "ab".repeat(32),
  };
  try {
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "const {db}=await import('./src/store.js');db.close();",
        ],
        { env, encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
    }
    const db = new DatabaseSync(join(dir, "app.sqlite"));
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
        2,
      );
      assert.equal(
        db.prepare("SELECT id FROM workspaces WHERE id='legacy'").get().id,
        "legacy",
      );
      assert.equal(
        db.prepare("SELECT name FROM contacts").get().name,
        "Existing",
      );
      assert.equal(
        db.prepare("SELECT message FROM campaigns").get().message,
        "Original content",
      );
      assert.equal(db.prepare("SELECT verified FROM users").get().verified, 0);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("production refuses insecure or incomplete configuration", () => {
  const run = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "await import('./src/config.js')"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        COOKIE_SECURE: "false",
        APP_URL: "http://localhost:3000",
        SMTP_URL: "",
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Production requires HTTPS/);
});
