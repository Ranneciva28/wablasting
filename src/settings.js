import { db, encrypt, decrypt } from "./store.js";
import { config, plans } from "./config.js";
import { ensure } from "./errors.js";
import { text } from "./validation.js";

function stored() {
  const row = db
    .prepare("SELECT payload FROM platform_settings WHERE id=1")
    .get();
  return row ? JSON.parse(decrypt(row.payload)) : {};
}
function apply(value) {
  for (const key of [
    "brand",
    "businessName",
    "supportEmail",
    "paymentInstructions",
    "smtp",
    "mailFrom",
    "publicSignup",
  ])
    if (Object.hasOwn(value, key)) config[key] = value[key];
  for (const [id, price] of Object.entries(value.prices || {}))
    if (Object.hasOwn(plans, id) && id !== "trial") plans[id].price = price;
}
apply(stored());
export function readiness() {
  return {
    identity: Boolean(config.businessName && config.supportEmail),
    smtp: Boolean(config.smtp && config.mailFrom),
    payment: Boolean(config.paymentInstructions),
  };
}
export function canRegister() {
  const r = readiness();
  return (
    config.publicSignup &&
    (!config.production || (r.identity && r.smtp && r.payment))
  );
}
function smtpView() {
  if (!config.smtp)
    return {
      enabled: false,
      host: "",
      port: 587,
      username: "",
      secure: false,
      hasPassword: false,
    };
  try {
    const s = new URL(config.smtp);
    return {
      enabled: true,
      host: s.hostname,
      port: Number(s.port || (s.protocol === "smtps:" ? 465 : 587)),
      username: decodeURIComponent(s.username),
      secure: s.protocol === "smtps:",
      hasPassword: Boolean(s.password),
    };
  } catch {
    return {
      enabled: false,
      host: "",
      port: 587,
      username: "",
      secure: false,
      hasPassword: false,
    };
  }
}
export function settingsView() {
  return {
    brand: config.brand,
    businessName: config.businessName,
    supportEmail: config.supportEmail,
    paymentInstructions: config.paymentInstructions,
    mailFrom: config.mailFrom,
    publicSignup: config.publicSignup,
    registrationAvailable: canRegister(),
    smtp: smtpView(),
    prices: Object.fromEntries(
      Object.entries(plans)
        .filter(([id]) => id !== "trial")
        .map(([id, p]) => [id, p.price]),
    ),
    readiness: readiness(),
  };
}
function optional(value, max, label) {
  ensure(
    typeof value === "string" && value.length <= max,
    400,
    `${label} tidak valid`,
  );
  return value.trim();
}
export function saveSettings(input) {
  const value = stored();
  for (const [key, max] of [
    ["brand", 100],
    ["businessName", 200],
    ["supportEmail", 200],
    ["paymentInstructions", 2000],
    ["mailFrom", 300],
  ])
    if (Object.hasOwn(input, key)) value[key] = optional(input[key], max, key);
  if (Object.hasOwn(value, "brand"))
    ensure(value.brand.length > 0, 400, "Nama brand wajib diisi");
  if (value.supportEmail)
    ensure(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.supportEmail),
      400,
      "Email bantuan tidak valid",
    );
  if (value.mailFrom) {
    const address = value.mailFrom.match(/<([^<>]+)>$/)?.[1] || value.mailFrom;
    ensure(
      !/[\r\n]/.test(value.mailFrom) &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
      400,
      "Email pengirim tidak valid",
    );
  }
  if (Object.hasOwn(input, "publicSignup")) {
    ensure(
      typeof input.publicSignup === "boolean",
      400,
      "Pilihan registrasi tidak valid",
    );
    value.publicSignup = input.publicSignup;
  }
  if (input.prices) {
    value.prices = { ...value.prices };
    for (const [id, price] of Object.entries(input.prices)) {
      ensure(
        ["starter", "growth", "business"].includes(id) &&
          Number.isSafeInteger(price) &&
          price >= 1000 &&
          price <= 1000000000,
        400,
        "Harga paket tidak valid",
      );
      value.prices[id] = price;
    }
  }
  if (input.smtp) {
    const smtp = input.smtp;
    ensure(typeof smtp.enabled === "boolean", 400, "Pilihan SMTP tidak valid");
    if (!smtp.enabled) value.smtp = "";
    else {
      const host = text(smtp.host, 253, "Host SMTP");
      ensure(/^[a-zA-Z0-9.-]+$/.test(host), 400, "Host SMTP tidak valid");
      ensure(
        Number.isInteger(smtp.port) &&
          smtp.port > 0 &&
          smtp.port <= 65535 &&
          typeof smtp.secure === "boolean",
        400,
        "Port atau keamanan SMTP tidak valid",
      );
      const username = text(smtp.username, 300, "Username SMTP");
      let password = smtp.password;
      ensure(
        typeof password === "string" && password.length <= 1000,
        400,
        "Password SMTP tidak valid",
      );
      if (!password) {
        const old = smtpView();
        ensure(
          old.enabled &&
            old.host === host &&
            old.username === username &&
            old.hasPassword,
          400,
          "Isi password untuk konfigurasi SMTP baru",
        );
        password = decodeURIComponent(new URL(config.smtp).password);
      }
      value.smtp = `${smtp.secure ? "smtps" : "smtp"}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${smtp.port}`;
      ensure(
        value.mailFrom ?? config.mailFrom,
        400,
        "Email pengirim wajib diisi saat SMTP aktif",
      );
    }
  }
  db.prepare(
    "INSERT INTO platform_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  ).run(encrypt(JSON.stringify(value)));
  apply(value);
  return settingsView();
}
