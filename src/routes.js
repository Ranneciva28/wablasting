import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { parse } from "csv-parse/sync";
import { db, transaction } from "./store.js";
import { plans, config } from "./config.js";
import { ensure } from "./errors.js";
import { text, phone } from "./validation.js";
import { verified, email, hash, checkPassword, rateLimit } from "./auth.js";
import {
  overview,
  workspace,
  requireActive,
  reserve,
  audit,
  newInvoice,
  settleInvoice,
} from "./saas.js";
import { queueMail, sendTestMail } from "./mail.js";
import { settingsView, saveSettings, readiness } from "./settings.js";
import * as wa from "./whatsapp.js";
export function scope(req, res, next) {
  const id = req.get("X-Workspace-Id") || req.user.id;
  const member = db
    .prepare("SELECT role FROM members WHERE workspace=? AND user=?")
    .get(id, req.user.id);
  ensure(member, 403, "Kamu tidak memiliki akses workspace ini");
  req.workspace = workspace(id);
  req.role = member.role;
  next();
}
export const role =
  (...allowed) =>
  (req, res, next) => {
    ensure(
      allowed.includes(req.role),
      403,
      "Role kamu tidak diizinkan melakukan tindakan ini",
    );
    next();
  };
const management = role("owner", "admin");
const owner = role("owner");
const live = (req, res, next) => {
  requireActive(req.workspace);
  next();
};
const page = (req) =>
  Math.max(0, Math.min(1000000, Number.parseInt(req.query.offset, 10) || 0));
const detail = (id, w) => {
  const c = db
    .prepare("SELECT * FROM campaigns WHERE id=? AND user=?")
    .get(id, w);
  ensure(c, 404, "Campaign tidak ditemukan");
  return c;
};
export const routes = Router();
routes.get("/workspace", (req, res) =>
  res.json({ ...overview(req.workspace), role: req.role }),
);
routes.patch("/workspace", management, (req, res) => {
  const name = text(req.body.name, 100, "Nama bisnis");
  db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(
    name,
    req.workspace.id,
  );
  audit(req.workspace.id, req.user.id, "workspace.updated");
  res.json({ ok: true });
});
routes.get("/whatsapp", (req, res) =>
  res.json({
    ...wa.status(req.workspace.id),
    ...(req.role === "operator" ? { qr: null } : {}),
  }),
);
routes.post(
  "/whatsapp/connect",
  management,
  verified,
  live,
  async (req, res) => {
    audit(req.workspace.id, req.user.id, "whatsapp.connect");
    res.json(await wa.connect(req.workspace.id));
  },
);
routes.post("/whatsapp/disconnect", management, async (req, res) => {
  await wa.disconnect(req.workspace.id);
  audit(req.workspace.id, req.user.id, "whatsapp.disconnect");
  res.json({ ok: true });
});
routes.get("/contacts", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,name,phone,optin FROM contacts WHERE user=? ORDER BY name LIMIT 100 OFFSET ?",
      )
      .all(req.workspace.id, page(req)),
  ),
);
function saveContact(w, body) {
  const n = phone(body.phone),
    name = text(body.name, 100, "Nama"),
    source = text(body.source, 300, "Sumber persetujuan");
  ensure(body.optin === true, 400, "Persetujuan penerima wajib dikonfirmasi");
  ensure(
    !db
      .prepare("SELECT phone FROM suppressions WHERE workspace=? AND phone=?")
      .get(w.id, n),
    409,
    "Nomor sudah opt-out; pulihkan dengan persetujuan baru melalui daftar opt-out",
  );
  const exists = db
    .prepare("SELECT id FROM contacts WHERE user=? AND phone=?")
    .get(w.id, n);
  const count = db
    .prepare("SELECT COUNT(*) n FROM contacts WHERE user=?")
    .get(w.id).n;
  ensure(
    exists || count < plans[w.plan].contacts,
    402,
    "Batas kontak paket tercapai",
  );
  db.prepare(
    "INSERT INTO contacts(id,user,name,phone,optin) VALUES(?,?,?,?,1) ON CONFLICT(user,phone) DO UPDATE SET name=excluded.name,optin=1",
  ).run(randomUUID(), w.id, name, n);
  db.prepare(
    "INSERT INTO consent VALUES(?,?,?,?) ON CONFLICT(workspace,phone) DO UPDATE SET source=excluded.source,created=excluded.created",
  ).run(w.id, n, source, Date.now());
}
routes.post("/contacts", verified, live, (req, res) => {
  transaction(() => saveContact(req.workspace, req.body));
  audit(req.workspace.id, req.user.id, "contact.saved");
  res.status(201).json({ ok: true });
});
routes.post("/contacts/import", verified, live, (req, res) => {
  const source = text(req.body.source, 300, "Sumber persetujuan");
  ensure(req.body.optin === true, 400, "Persetujuan wajib dikonfirmasi");
  const csv = text(req.body.csv, 200000, "CSV");
  let rows;
  try {
    rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 2000,
    });
  } catch {
    ensure(false, 400, "CSV tidak valid. Gunakan kolom name,phone.");
  }
  ensure(
    rows.length > 0 && rows.length <= 1000,
    400,
    "Impor maksimal 1.000 baris sekali proses",
  );
  transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      try {
        saveContact(req.workspace, { ...rows[i], source, optin: true });
      } catch (e) {
        e.message = `Baris ${i + 2}: ${e.message}`;
        throw e;
      }
    }
  });
  audit(req.workspace.id, req.user.id, "contacts.imported", {
    count: rows.length,
  });
  res.status(201).json({ count: rows.length });
});
routes.delete("/contacts/:id", (req, res) => {
  const c = db
    .prepare("SELECT * FROM contacts WHERE id=? AND user=?")
    .get(req.params.id, req.workspace.id);
  ensure(c, 404, "Kontak tidak ditemukan");
  transaction(() => {
    db.prepare("DELETE FROM contacts WHERE id=?").run(c.id);
    db.prepare("DELETE FROM consent WHERE workspace=? AND phone=?").run(
      req.workspace.id,
      c.phone,
    );
  });
  audit(req.workspace.id, req.user.id, "contact.deleted");
  res.json({ ok: true });
});
routes.get("/suppressions", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT phone,created FROM suppressions WHERE workspace=? ORDER BY created DESC LIMIT 100 OFFSET ?",
      )
      .all(req.workspace.id, page(req)),
  ),
);
routes.post("/suppressions", (req, res) => {
  const n = phone(req.body.phone);
  transaction(() => {
    db.prepare("INSERT OR IGNORE INTO suppressions VALUES(?,?,?)").run(
      req.workspace.id,
      n,
      Date.now(),
    );
    db.prepare("UPDATE contacts SET optin=0 WHERE user=? AND phone=?").run(
      req.workspace.id,
      n,
    );
  });
  audit(req.workspace.id, req.user.id, "contact.optout", { phone: n });
  res.json({ ok: true });
});
routes.delete(
  "/suppressions/:phone",
  management,
  verified,
  live,
  (req, res) => {
    const n = phone(req.params.phone),
      source = text(req.body.source, 300, "Bukti persetujuan baru");
    transaction(() => {
      db.prepare("DELETE FROM suppressions WHERE workspace=? AND phone=?").run(
        req.workspace.id,
        n,
      );
      db.prepare("UPDATE contacts SET optin=1 WHERE user=? AND phone=?").run(
        req.workspace.id,
        n,
      );
      db.prepare(
        "INSERT INTO consent VALUES(?,?,?,?) ON CONFLICT(workspace,phone) DO UPDATE SET source=excluded.source,created=excluded.created",
      ).run(req.workspace.id, n, source, Date.now());
    });
    audit(req.workspace.id, req.user.id, "contact.resubscribed", {
      phone: n,
      source,
    });
    res.json({ ok: true });
  },
);
routes.get("/templates", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,name,message FROM templates WHERE workspace=? ORDER BY name",
      )
      .all(req.workspace.id),
  ),
);
routes.post("/templates", verified, live, (req, res) => {
  ensure(
    db
      .prepare("SELECT COUNT(*) n FROM templates WHERE workspace=?")
      .get(req.workspace.id).n < 100,
    400,
    "Maksimal 100 template",
  );
  const id = randomUUID();
  db.prepare("INSERT INTO templates VALUES(?,?,?,?)").run(
    id,
    req.workspace.id,
    text(req.body.name, 100, "Nama"),
    text(req.body.message, 4000, "Pesan"),
  );
  res.status(201).json({ id });
});
routes.delete("/templates/:id", (req, res) => {
  db.prepare("DELETE FROM templates WHERE id=? AND workspace=?").run(
    req.params.id,
    req.workspace.id,
  );
  res.json({ ok: true });
});
routes.get("/campaigns", (req, res) =>
  res.json(
    db
      .prepare(
        `SELECT c.*,COUNT(d.id) total,SUM(d.status='sent') sent,SUM(d.status='unknown') unknown_count,SUM(d.status='skipped') skipped FROM campaigns c LEFT JOIN deliveries d ON d.campaign=c.id WHERE c.user=? GROUP BY c.id ORDER BY c.created DESC LIMIT 50 OFFSET ?`,
      )
      .all(req.workspace.id, page(req)),
  ),
);
routes.get("/campaigns/:id", (req, res) => {
  const c = detail(req.params.id, req.workspace.id);
  res.json({
    ...c,
    deliveries: db
      .prepare(
        "SELECT * FROM deliveries WHERE campaign=? ORDER BY rowid LIMIT 100 OFFSET ?",
      )
      .all(c.id, page(req)),
  });
});
routes.post("/campaigns", verified, live, (req, res) => {
  const key = text(req.get("Idempotency-Key"), 100, "Idempotency-Key");
  ensure(
    /^[a-zA-Z0-9_-]{8,100}$/.test(key),
    400,
    "Idempotency-Key tidak valid",
  );
  const fingerprint = hash(
    JSON.stringify({
      name: req.body.name,
      message: req.body.message,
      contacts: Array.isArray(req.body.contacts)
        ? [...new Set(req.body.contacts)].sort()
        : req.body.contacts,
      scheduled: req.body.scheduled || null,
    }),
  );
  const previous = db
    .prepare(
      "SELECT id,request_hash FROM campaigns WHERE user=? AND request_key=?",
    )
    .get(req.workspace.id, key);
  if (previous) {
    ensure(
      previous.request_hash === fingerprint,
      409,
      "Idempotency-Key sudah dipakai dengan data berbeda",
    );
    return res.json({ id: previous.id, replayed: true });
  }
  const name = text(req.body.name, 100, "Nama campaign"),
    message = text(req.body.message, 4000, "Pesan");
  ensure(
    wa.status(req.workspace.id).state === "connected",
    409,
    "Hubungkan WhatsApp dahulu",
  );
  ensure(
    Array.isArray(req.body.contacts) &&
      req.body.contacts.length > 0 &&
      req.body.contacts.length <= plans[req.workspace.plan].batch,
    400,
    `Pilih 1–${plans[req.workspace.plan].batch} kontak`,
  );
  let scheduled = req.body.scheduled ? Number(req.body.scheduled) : null;
  ensure(
    scheduled === null ||
      (Number.isSafeInteger(scheduled) &&
        scheduled >= Date.now() - 60000 &&
        scheduled <= Date.now() + 30 * 86400000),
    400,
    "Jadwal harus dalam 30 hari ke depan",
  );
  if (scheduled)
    ensure(
      scheduled < req.workspace.period_end,
      402,
      "Jadwal melewati masa aktif paket",
    );
  const id = transaction(() => {
    ensure(
      !db
        .prepare(
          "SELECT id FROM campaigns WHERE user=? AND status IN ('queued','running','paused')",
        )
        .get(req.workspace.id),
      409,
      "Selesaikan atau batalkan campaign sebelumnya",
    );
    const contacts = [...new Set(req.body.contacts)].map((id) =>
      db
        .prepare(
          "SELECT * FROM contacts WHERE id=? AND user=? AND optin=1 AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.workspace=contacts.user AND s.phone=contacts.phone)",
        )
        .get(id, req.workspace.id),
    );
    ensure(
      contacts.every(Boolean),
      400,
      "Kontak tidak valid atau sudah opt-out",
    );
    reserve(req.workspace, contacts.length);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO campaigns(id,user,name,message,status,created,scheduled,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      req.workspace.id,
      name,
      message,
      "queued",
      Date.now(),
      scheduled,
      key,
      fingerprint,
    );
    for (const c of contacts)
      db.prepare(
        "INSERT INTO deliveries(id,campaign,phone,name) VALUES(?,?,?,?)",
      ).run(randomUUID(), id, c.phone, c.name);
    audit(req.workspace.id, req.user.id, "campaign.created", {
      id,
      count: contacts.length,
    });
    return id;
  });
  res.status(201).json({ id });
});
routes.post("/campaigns/:id/:action", verified, (req, res) => {
  const c = detail(req.params.id, req.workspace.id),
    action = req.params.action;
  const state = { pause: "paused", resume: "queued", cancel: "cancelled" }[
    action
  ];
  ensure(
    state && !["completed", "cancelled"].includes(c.status),
    409,
    "Perubahan status tidak valid",
  );
  if (action === "resume") requireActive(req.workspace);
  db.prepare("UPDATE campaigns SET status=? WHERE id=?").run(state, c.id);
  audit(req.workspace.id, req.user.id, `campaign.${action}`, { id: c.id });
  res.json({ ok: true });
});
routes.get("/billing", (req, res) =>
  res.json({
    workspace: overview(req.workspace),
    instructions: config.paymentInstructions,
    invoices: db
      .prepare(
        "SELECT * FROM invoices WHERE workspace=? ORDER BY created DESC LIMIT 50",
      )
      .all(req.workspace.id),
  }),
);
routes.post("/billing/invoices", owner, verified, (req, res) => {
  ensure(
    !config.production || (readiness().identity && readiness().payment),
    503,
    "Pembayaran belum dibuka. Pengelola perlu melengkapi identitas bisnis dan rekening.",
  );
  const invoice = newInvoice(req.workspace, req.body.plan);
  audit(req.workspace.id, req.user.id, "invoice.created", { id: invoice.id });
  res.status(201).json(invoice);
});
routes.post("/billing/invoices/:id/:action", owner, verified, (req, res) => {
  const i = db
    .prepare("SELECT * FROM invoices WHERE id=? AND workspace=?")
    .get(req.params.id, req.workspace.id);
  ensure(i, 404, "Invoice tidak ditemukan");
  ensure(
    ["pending", "review"].includes(i.status) && i.expires > Date.now(),
    409,
    "Invoice tidak aktif",
  );
  if (req.params.action === "confirm") {
    const ref = text(req.body.reference, 300, "Referensi transfer");
    db.prepare(
      "UPDATE invoices SET status='review',reference=? WHERE id=?",
    ).run(ref, i.id);
    audit(req.workspace.id, req.user.id, "invoice.submitted", { id: i.id });
  } else {
    ensure(req.params.action === "cancel", 404, "Aksi tidak tersedia");
    db.prepare("UPDATE invoices SET status='cancelled' WHERE id=?").run(i.id);
  }
  res.json({ ok: true });
});
routes.get("/team", management, (req, res) =>
  res.json({
    members: db
      .prepare(
        "SELECT u.id,u.email,m.role FROM members m JOIN users u ON u.id=m.user WHERE m.workspace=?",
      )
      .all(req.workspace.id),
    invites: db
      .prepare(
        "SELECT email,role,expires FROM invites WHERE workspace=? AND expires>?",
      )
      .all(req.workspace.id, Date.now()),
  }),
);
routes.post("/team/invite", owner, verified, live, (req, res) => {
  const address = email(req.body.email),
    memberRole = req.body.role;
  ensure(["admin", "operator"].includes(memberRole), 400, "Role tidak valid");
  transaction(() => {
    const count =
      db
        .prepare("SELECT COUNT(*) n FROM members WHERE workspace=?")
        .get(req.workspace.id).n +
      db
        .prepare(
          "SELECT COUNT(*) n FROM invites WHERE workspace=? AND expires>?",
        )
        .get(req.workspace.id, Date.now()).n;
    ensure(
      count < plans[req.workspace.plan].seats,
      402,
      "Batas anggota paket tercapai",
    );
    ensure(
      !db
        .prepare(
          "SELECT 1 FROM members m JOIN users u ON u.id=m.user WHERE m.workspace=? AND u.email=?",
        )
        .get(req.workspace.id, address),
      409,
      "Pengguna sudah menjadi anggota",
    );
    ensure(
      !db
        .prepare(
          "SELECT 1 FROM invites WHERE workspace=? AND email=? AND expires>?",
        )
        .get(req.workspace.id, address, Date.now()),
      409,
      "Undangan masih aktif",
    );
    const raw = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO invites VALUES(?,?,?,?,?)").run(
      hash(raw),
      req.workspace.id,
      address,
      memberRole,
      Date.now() + 7 * 86400000,
    );
    queueMail(
      address,
      `Undangan ${req.workspace.name}`,
      `Masuk atau daftar menggunakan ${address}, lalu buka tautan ini:\n${config.url}/app#invite=${raw}`,
    );
    audit(req.workspace.id, req.user.id, "team.invited", {
      email: address,
      role: memberRole,
    });
  });
  res.status(201).json({ ok: true });
});
routes.delete("/team/invites/:email", owner, (req, res) => {
  db.prepare("DELETE FROM invites WHERE workspace=? AND email=?").run(
    req.workspace.id,
    email(req.params.email),
  );
  res.json({ ok: true });
});
routes.patch("/team/:id", owner, (req, res) => {
  ensure(
    ["admin", "operator"].includes(req.body.role),
    400,
    "Role tidak valid",
  );
  const result = db
    .prepare(
      "UPDATE members SET role=? WHERE workspace=? AND user=? AND role<>'owner'",
    )
    .run(req.body.role, req.workspace.id, req.params.id);
  ensure(result.changes, 404, "Anggota tidak ditemukan");
  audit(req.workspace.id, req.user.id, "team.role_updated", {
    user: req.params.id,
    role: req.body.role,
  });
  res.json({ ok: true });
});
routes.delete("/team/:id", owner, (req, res) => {
  const result = db
    .prepare(
      "DELETE FROM members WHERE workspace=? AND user=? AND role<>'owner'",
    )
    .run(req.workspace.id, req.params.id);
  ensure(result.changes, 404, "Anggota tidak ditemukan");
  audit(req.workspace.id, req.user.id, "team.removed", { user: req.params.id });
  res.json({ ok: true });
});
routes.get("/audit", management, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT action,actor,detail,created FROM audit WHERE workspace=? ORDER BY created DESC LIMIT 100 OFFSET ?",
      )
      .all(req.workspace.id, page(req)),
  ),
);
routes.get("/export", owner, (req, res) => {
  audit(req.workspace.id, req.user.id, "workspace.exported");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="workspace-export.json"',
  );
  res.json({
    workspace: req.workspace,
    contacts: db
      .prepare("SELECT name,phone,optin FROM contacts WHERE user=?")
      .all(req.workspace.id),
    consent: db
      .prepare("SELECT phone,source,created FROM consent WHERE workspace=?")
      .all(req.workspace.id),
    suppressions: db
      .prepare("SELECT phone,created FROM suppressions WHERE workspace=?")
      .all(req.workspace.id),
    campaigns: db
      .prepare("SELECT * FROM campaigns WHERE user=?")
      .all(req.workspace.id),
    deliveries: db
      .prepare(
        "SELECT d.* FROM deliveries d JOIN campaigns c ON c.id=d.campaign WHERE c.user=?",
      )
      .all(req.workspace.id),
  });
});
// Delete a business workspace while retaining the account, invoices and audit for operations.
routes.delete("/workspace/data", owner, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  ensure(
    await checkPassword(req.body.password, user.password),
    403,
    "Password salah",
  );
  ensure(req.body.confirm === "DELETE", 400, "Konfirmasi DELETE diperlukan");
  await wa.disconnect(req.workspace.id);
  transaction(() => {
    db.prepare(
      "UPDATE campaigns SET status='cancelled' WHERE user=? AND status IN ('queued','running','paused')",
    ).run(req.workspace.id);
    ensure(
      !db
        .prepare(
          "SELECT d.id FROM deliveries d JOIN campaigns c ON c.id=d.campaign WHERE c.user=? AND d.status='sending'",
        )
        .get(req.workspace.id),
      409,
      "Tunggu pengiriman yang sedang berjalan selesai, lalu ulangi",
    );
    db.prepare(
      "DELETE FROM deliveries WHERE campaign IN (SELECT id FROM campaigns WHERE user=?)",
    ).run(req.workspace.id);
    for (const [table, col] of [
      ["campaigns", "user"],
      ["contacts", "user"],
      ["consent", "workspace"],
      ["suppressions", "workspace"],
      ["templates", "workspace"],
    ])
      db.prepare(`DELETE FROM ${table} WHERE ${col}=?`).run(req.workspace.id);
    audit(req.workspace.id, req.user.id, "workspace.data_deleted");
  });
  res.json({ ok: true });
});
export const invitations = Router();
invitations.post("/invites/accept", verified, (req, res) => {
  const result = transaction(() => {
    const i = db
      .prepare("SELECT * FROM invites WHERE hash=? AND expires>?")
      .get(hash(text(req.body.token, 128, "Token")), Date.now());
    ensure(
      i && i.email === req.user.email,
      400,
      "Undangan tidak valid, kedaluwarsa, atau email tidak cocok",
    );
    const w = workspace(i.workspace);
    requireActive(w);
    ensure(
      db.prepare("SELECT COUNT(*) n FROM members WHERE workspace=?").get(w.id)
        .n < plans[w.plan].seats,
      402,
      "Batas anggota tercapai",
    );
    db.prepare("INSERT INTO members VALUES(?,?,?) ON CONFLICT DO NOTHING").run(
      w.id,
      req.user.id,
      i.role,
    );
    db.prepare("DELETE FROM invites WHERE hash=?").run(i.hash);
    audit(w.id, req.user.id, "team.joined");
    return { id: w.id };
  });
  res.json(result);
});
export const admin = Router();
admin.use((req, res, next) => {
  ensure(req.user.superAdmin, 403, "Akses admin platform diperlukan");
  next();
});
admin.get("/settings", (req, res) => res.json(settingsView()));
admin.put("/settings", async (req, res) => {
  const user = db
    .prepare("SELECT password FROM users WHERE id=?")
    .get(req.user.id);
  ensure(
    await checkPassword(req.body.currentPassword, user.password),
    403,
    "Password akun admin salah",
  );
  const view = saveSettings(req.body);
  audit(req.user.id, req.user.id, "platform.settings_updated", {
    smtpConfigured: view.readiness.smtp,
  });
  res.json(view);
});
admin.post(
  "/settings/test-email",
  rateLimit(5, 3600000, "smtp-test"),
  async (req, res) => {
    const user = db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(req.user.id);
    ensure(
      await checkPassword(req.body.currentPassword, user.password),
      403,
      "Password akun admin salah",
    );
    try {
      await sendTestMail(req.user.email);
    } catch {
      ensure(
        false,
        503,
        "Email tes gagal. Periksa host, port, username, password SMTP dan email pengirim.",
      );
    }
    audit(req.user.id, req.user.id, "platform.email_tested");
    res.json({ ok: true, to: req.user.email });
  },
);
admin.get("/overview", (req, res) =>
  res.json({
    workspaces: db
      .prepare(
        "SELECT w.*,(SELECT email FROM users WHERE id=w.id) email FROM workspaces w ORDER BY created DESC LIMIT 100 OFFSET ?",
      )
      .all(page(req)),
    invoices: db
      .prepare(
        "SELECT i.*,w.name FROM invoices i JOIN workspaces w ON w.id=i.workspace ORDER BY i.created DESC LIMIT 100 OFFSET ?",
      )
      .all(page(req)),
    mail: db
      .prepare("SELECT status,COUNT(*) count FROM mail GROUP BY status")
      .all(),
    revenue: db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) amount FROM invoices WHERE status='paid'",
      )
      .get(),
    total: db.prepare("SELECT COUNT(*) n FROM workspaces").get().n,
  }),
);
admin.post("/invoices/:id/approve", (req, res) => {
  const reference = text(
    req.body.reference,
    300,
    "Referensi verifikasi pembayaran",
  );
  res.json(settleInvoice(req.params.id, req.user.id, reference));
});
admin.post("/invoices/:id/reject", (req, res) => {
  const i = db.prepare("SELECT * FROM invoices WHERE id=?").get(req.params.id);
  ensure(
    i && ["pending", "review"].includes(i.status),
    409,
    "Invoice tidak dapat ditolak",
  );
  db.prepare("UPDATE invoices SET status='rejected' WHERE id=?").run(i.id);
  audit(i.workspace, req.user.id, "invoice.rejected", {
    id: i.id,
    reason: text(req.body.reason, 300, "Alasan"),
  });
  res.json({ ok: true });
});
admin.post("/workspaces/:id/status", async (req, res) => {
  const w = workspace(req.params.id);
  ensure(w, 404, "Workspace tidak ditemukan");
  ensure(
    ["active", "suspended"].includes(req.body.status),
    400,
    "Status tidak valid",
  );
  db.prepare("UPDATE workspaces SET status=? WHERE id=?").run(
    req.body.status,
    w.id,
  );
  if (req.body.status === "suspended") {
    db.prepare(
      "UPDATE campaigns SET status='paused' WHERE user=? AND status IN ('queued','running')",
    ).run(w.id);
    await wa.disconnect(w.id);
  }
  audit(w.id, req.user.id, "workspace.status", { status: req.body.status });
  res.json({ ok: true });
});
