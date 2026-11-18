import { Router } from "express";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { db, transaction } from "./store.js";
import { config } from "./config.js";
import { text } from "./validation.js";
import { ensure } from "./errors.js";
import { createWorkspace, audit, isSuperAdmin } from "./saas.js";
import { queueMail } from "./mail.js";
import { canRegister } from "./settings.js";
const derive = promisify(scrypt);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const cookie = (token, age) =>
  `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? "; Secure" : ""}`;
const cookieToken = (req) =>
  req.headers.cookie?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
export function email(value) {
  const result = text(value, 200, "Email").toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), 400, "Email tidak valid");
  return result;
}
export function password(value) {
  ensure(
    typeof value === "string" && value.length >= 12 && value.length <= 128,
    400,
    "Password harus 12–128 karakter",
  );
  return value;
}
export async function encodePassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password(value), salt, 64)).toString("hex")}`;
}
export async function checkPassword(value, stored) {
  const [salt, expected] = (stored || `dummy:${"0".repeat(128)}`).split(":");
  const actual = await derive(password(value), salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function newSession(res, user) {
  const raw = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hash(raw),
    user,
    Date.now() + 86400000,
  );
  res.setHeader("Set-Cookie", cookie(raw, 86400));
}
export function token(user, kind) {
  const raw = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM tokens WHERE user=? AND kind=?").run(user, kind);
  db.prepare("INSERT INTO tokens VALUES(?,?,?,?)").run(
    hash(raw),
    user,
    kind,
    Date.now() + 3600000,
  );
  return raw;
}
export function verification(user) {
  const raw = token(user.id, "verify");
  queueMail(
    user.email,
    `Verifikasi email ${config.brand}`,
    `Verifikasi email kamu (berlaku 1 jam):\n${config.url}/app#verify=${raw}`,
  );
}
const limits = new Map();
export function rateLimit(limit, windowMs = 900000, prefix = "api") {
  return (req, res, next) => {
    const key = `${prefix}:${req.ip}`;
    const now = Date.now();
    let bucket = limits.get(key);
    if (!bucket || bucket.until <= now) {
      if (limits.size >= 10000) {
        for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
        if (limits.size >= 10000)
          return res
            .status(429)
            .json({ error: "Server sibuk. Coba lagi nanti." });
      }
      bucket = { count: 0, until: now + windowMs };
      limits.set(key, bucket);
    }
    if (++bucket.count > limit) {
      res.set("Retry-After", String(Math.ceil((bucket.until - now) / 1000)));
      return res
        .status(429)
        .json({ error: "Terlalu banyak permintaan. Coba beberapa saat lagi." });
    }
    next();
  };
}
export const auth = Router();
auth.use(rateLimit(30, 900000, "auth"));
auth.post("/register", async (req, res) => {
  ensure(
    !config.production || canRegister(),
    503,
    "Pendaftaran belum dibuka. Pengelola perlu melengkapi pengaturan layanan.",
  );
  const address = email(req.body.email),
    name = text(req.body.company || address.split("@")[0], 100, "Nama bisnis");
  ensure(
    config.publicSignup ||
      (process.env.REGISTRATION_CODE &&
        req.body.code === process.env.REGISTRATION_CODE),
    403,
    "Pendaftaran memerlukan kode undangan",
  );
  ensure(
    req.body.acceptTerms === true,
    400,
    "Persetujuan ketentuan dan privasi wajib diisi",
  );
  const encoded = await encodePassword(req.body.password);
  const user = transaction(() => {
    ensure(
      !db.prepare("SELECT id FROM users WHERE email=?").get(address),
      409,
      "Email sudah terdaftar",
    );
    const u = { id: randomUUID(), email: address };
    db.prepare("INSERT INTO users(id,email,password) VALUES(?,?,?)").run(
      u.id,
      address,
      encoded,
    );
    createWorkspace(u.id, name);
    verification(u);
    audit(u.id, u.id, "account.registered", { terms: "2026-11-15" });
    return u;
  });
  newSession(res, user.id);
  res.status(201).json({ email: address, verificationRequired: true });
});
auth.post("/login", async (req, res) => {
  const address = email(req.body.email);
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(address);
  ensure(
    (await checkPassword(req.body.password, user?.password)) && user,
    401,
    "Email atau password salah",
  );
  newSession(res, user.id);
  res.json({ email: user.email });
});
auth.post("/forgot", (req, res) => {
  const address = email(req.body.email);
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(address);
  if (user) {
    const raw = token(user.id, "reset");
    queueMail(
      address,
      `Reset password ${config.brand}`,
      `Reset password (berlaku 1 jam):\n${config.url}/app#reset=${raw}`,
    );
  }
  res.json({
    ok: true,
    message: "Jika email terdaftar, tautan reset akan dikirim.",
  });
});
auth.post("/reset", async (req, res) => {
  const raw = text(req.body.token, 128, "Token"),
    encoded = await encodePassword(req.body.password);
  transaction(() => {
    const t = db
      .prepare(
        "SELECT * FROM tokens WHERE hash=? AND kind='reset' AND expires>?",
      )
      .get(hash(raw), Date.now());
    ensure(t, 400, "Tautan tidak valid atau kedaluwarsa");
    db.prepare("UPDATE users SET password=? WHERE id=?").run(encoded, t.user);
    db.prepare("DELETE FROM sessions WHERE user=?").run(t.user);
    db.prepare("DELETE FROM tokens WHERE user=?").run(t.user);
    audit(t.user, t.user, "password.reset");
  });
  res.json({ ok: true });
});
auth.post("/verify", (req, res) => {
  transaction(() => {
    const t = db
      .prepare(
        "SELECT * FROM tokens WHERE hash=? AND kind='verify' AND expires>?",
      )
      .get(hash(text(req.body.token, 128, "Token")), Date.now());
    ensure(t, 400, "Tautan tidak valid atau kedaluwarsa");
    db.prepare("UPDATE users SET verified=1 WHERE id=?").run(t.user);
    db.prepare("DELETE FROM tokens WHERE hash=?").run(t.hash);
    audit(t.user, t.user, "email.verified");
  });
  res.json({ ok: true });
});
export function authenticated(req, res, next) {
  const raw = cookieToken(req);
  const row =
    raw &&
    db
      .prepare(
        "SELECT u.id,u.email,u.verified FROM sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>?",
      )
      .get(hash(raw), Date.now());
  if (!row) return res.status(401).json({ error: "Silakan login" });
  req.user = { ...row, superAdmin: isSuperAdmin(row) };
  next();
}
export const account = Router();
account.get("/me", (req, res) =>
  res.json({
    ...req.user,
    workspaces: db
      .prepare(
        "SELECT w.id,w.name,m.role FROM members m JOIN workspaces w ON w.id=m.workspace WHERE m.user=?",
      )
      .all(req.user.id),
  }),
);
account.post("/logout", (req, res) => {
  const raw = cookieToken(req);
  if (raw) db.prepare("DELETE FROM sessions WHERE token=?").run(hash(raw));
  res.setHeader("Set-Cookie", cookie("", 0));
  res.json({ ok: true });
});
account.post("/account/verify", rateLimit(5, 3600000, "verify"), (req, res) => {
  if (!req.user.verified) verification(req.user);
  res.json({ ok: true });
});
account.post("/account/password", async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  ensure(
    await checkPassword(req.body.current, user.password),
    403,
    "Password saat ini salah",
  );
  const encoded = await encodePassword(req.body.password);
  transaction(() => {
    db.prepare("UPDATE users SET password=? WHERE id=?").run(encoded, user.id);
    db.prepare("DELETE FROM sessions WHERE user=?").run(user.id);
    db.prepare("DELETE FROM tokens WHERE user=?").run(user.id);
  });
  res.setHeader("Set-Cookie", cookie("", 0));
  res.json({ ok: true });
});
export function verified(req, res, next) {
  ensure(
    req.user.verified,
    403,
    "Verifikasi email dahulu melalui tautan yang dikirim ke inbox kamu",
  );
  next();
}
