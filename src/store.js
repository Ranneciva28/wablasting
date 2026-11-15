import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
export const dataDir = resolve(process.env.DATA_DIR || "./data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, "app.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth(user TEXT,key TEXT,value TEXT,PRIMARY KEY(user,key));
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,phone TEXT,optin INTEGER DEFAULT 0,UNIQUE(user,phone));
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,message TEXT,status TEXT DEFAULT 'queued',created INTEGER);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,campaign TEXT REFERENCES campaigns(id),phone TEXT,name TEXT,status TEXT DEFAULT 'pending',error TEXT,waid TEXT);
`);
const secret = process.env.SESSION_ENCRYPTION_KEY;
if (!/^[a-f0-9]{64}$/i.test(secret || ""))
  throw new Error("SESSION_ENCRYPTION_KEY must be 64 hex characters");
const key = Buffer.from(secret, "hex");
export function encrypt(value) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return seal(c, iv, value);
}
function seal(c, iv, value) {
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function decrypt(value) {
  const b = Buffer.from(value, "base64");
  const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
}

// Additive, transactional migrations preserve v0.1 accounts, contacts and sessions.
export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const migrations = [
  `ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE workspaces(id TEXT PRIMARY KEY REFERENCES users(id),name TEXT NOT NULL,plan TEXT NOT NULL DEFAULT 'trial',status TEXT NOT NULL DEFAULT 'active',period_start INTEGER NOT NULL,period_end INTEGER NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE members(workspace TEXT REFERENCES workspaces(id),user TEXT REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','admin','operator')),PRIMARY KEY(workspace,user));
   CREATE TABLE tokens(hash TEXT PRIMARY KEY,user TEXT REFERENCES users(id),kind TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE invites(hash TEXT PRIMARY KEY,workspace TEXT REFERENCES workspaces(id),email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE usage(workspace TEXT REFERENCES workspaces(id),period_start INTEGER,amount INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace,period_start));
   CREATE TABLE invoices(id TEXT PRIMARY KEY,workspace TEXT REFERENCES workspaces(id),plan TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,paid INTEGER,reference TEXT);
   CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT,actor TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE mail(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE suppressions(workspace TEXT REFERENCES workspaces(id),phone TEXT,created INTEGER NOT NULL,PRIMARY KEY(workspace,phone));
   CREATE TABLE consent(workspace TEXT,phone TEXT,source TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(workspace,phone));
   CREATE TABLE templates(id TEXT PRIMARY KEY,workspace TEXT REFERENCES workspaces(id),name TEXT NOT NULL,message TEXT NOT NULL);
   ALTER TABLE campaigns ADD COLUMN scheduled INTEGER;
   ALTER TABLE campaigns ADD COLUMN request_key TEXT;
   CREATE UNIQUE INDEX campaigns_request_key ON campaigns(user,request_key) WHERE request_key IS NOT NULL;
   CREATE INDEX contacts_owner ON contacts(user,name);
   CREATE INDEX campaigns_owner ON campaigns(user,created);
   CREATE INDEX deliveries_queue ON deliveries(campaign,status);
   CREATE INDEX sessions_expiry ON sessions(expires);
   CREATE INDEX audit_workspace ON audit(workspace,created);
   CREATE INDEX tokens_user ON tokens(user,kind);
   CREATE INDEX mail_pending ON mail(status,next_attempt);
  `,
  `ALTER TABLE campaigns ADD COLUMN request_hash TEXT;`,
];
db.exec(
  "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied INTEGER NOT NULL)",
);
for (let i = 0; i < migrations.length; i++) {
  if (
    !db
      .prepare("SELECT version FROM schema_migrations WHERE version=?")
      .get(i + 1)
  ) {
    transaction(() => {
      db.exec(migrations[i]);
      if (i === 0) {
        const now = Date.now();
        for (const user of db.prepare("SELECT id,email FROM users").all()) {
          db.prepare("INSERT INTO workspaces VALUES(?,?,?,?,?,?,?)").run(
            user.id,
            user.email.split("@")[0],
            "trial",
            "active",
            now,
            now + 7 * 86400000,
            now,
          );
          db.prepare("INSERT INTO members VALUES(?,?,?)").run(
            user.id,
            user.id,
            "owner",
          );
        }
      }
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        i + 1,
        Date.now(),
      );
    });
  }
}
