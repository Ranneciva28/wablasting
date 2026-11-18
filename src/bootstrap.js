import { Router } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { db, dataDir, transaction } from "./store.js";
import { config } from "./config.js";
import { ensure } from "./errors.js";
import {
  email,
  encodePassword,
  checkPassword,
  rateLimit,
  newSession,
} from "./auth.js";
import { createWorkspace, audit, isSuperAdmin } from "./saas.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const keyFile = resolve(dataDir, "setup-access");
export function setupNeeded() {
  if (db.prepare("SELECT user FROM platform_admins LIMIT 1").get())
    return false;
  return !db
    .prepare("SELECT id,email,verified FROM users WHERE verified=1")
    .all()
    .some(isSuperAdmin);
}
export function ensureSetupKey() {
  if (!setupNeeded()) {
    try {
      unlinkSync(keyFile);
    } catch {}
    db.prepare("DELETE FROM bootstrap").run();
    return null;
  }
  let old;
  try {
    old = readFileSync(keyFile, "utf8").trim();
  } catch {}
  const row = db.prepare("SELECT * FROM bootstrap WHERE id=1").get();
  if (old && row?.hash === digest(old) && row.expires > Date.now()) return old;
  const raw = randomBytes(32).toString("hex");
  writeFileSync(keyFile, raw, { mode: 0o600 });
  db.prepare(
    "INSERT INTO bootstrap VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,expires=excluded.expires",
  ).run(digest(raw), Date.now() + 86400000);
  return raw;
}
export const setup = Router();
setup.use(rateLimit(20, 900000, "setup"));
setup.get("/status", (req, res) => res.json({ required: setupNeeded() }));
setup.post("/complete", async (req, res) => {
  const raw = req.get("X-Setup-Key") || "";
  ensure(/^[a-f0-9]{64}$/.test(raw), 403, "Tautan setup tidak valid");
  const valid = () => {
    const row = db.prepare("SELECT * FROM bootstrap WHERE id=1").get();
    ensure(
      setupNeeded() &&
        row &&
        row.expires > Date.now() &&
        row.hash === digest(raw),
      403,
      "Tautan setup kedaluwarsa atau sudah digunakan",
    );
  };
  valid();
  const address = email(req.body.email);
  const existing = db.prepare("SELECT * FROM users WHERE email=?").get(address);
  const encoded = await encodePassword(req.body.password);
  if (existing)
    ensure(
      await checkPassword(req.body.password, existing.password),
      403,
      "Akun sudah ada. Gunakan password akun tersebut.",
    );
  const id = transaction(() => {
    valid();
    const id = existing?.id || randomUUID();
    if (!existing) {
      db.prepare(
        "INSERT INTO users(id,email,password,verified) VALUES(?,?,?,1)",
      ).run(id, address, encoded);
      createWorkspace(id, config.businessName || "Workspace admin");
    } else db.prepare("UPDATE users SET verified=1 WHERE id=?").run(id);
    db.prepare("INSERT INTO platform_admins VALUES(?)").run(id);
    db.prepare("DELETE FROM bootstrap").run();
    audit(id, id, "platform.initialized");
    return id;
  });
  try {
    unlinkSync(keyFile);
  } catch {}
  newSession(res, id);
  res.status(201).json({ ok: true });
});
