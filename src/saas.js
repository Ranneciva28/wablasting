import { randomUUID } from "node:crypto";
import { db, transaction } from "./store.js";
import { config, plans } from "./config.js";
import { ensure } from "./errors.js";
export function audit(workspace, actor, action, detail = {}) {
  db.prepare(
    "INSERT INTO audit(workspace,actor,action,detail,created) VALUES(?,?,?,?,?)",
  ).run(workspace, actor, action, JSON.stringify(detail), Date.now());
}
export function isSuperAdmin(user) {
  return Boolean(
    user.verified &&
    (config.adminEmails.includes(user.email) ||
      db.prepare("SELECT user FROM platform_admins WHERE user=?").get(user.id)),
  );
}
export function workspace(id) {
  return db.prepare("SELECT * FROM workspaces WHERE id=?").get(id);
}
export function active(w) {
  return w && w.status === "active" && w.period_end > Date.now();
}
export function requireActive(w) {
  ensure(
    active(w),
    402,
    "Paket sudah berakhir atau workspace dinonaktifkan. Periksa langganan.",
  );
}
export function usage(w) {
  return (
    db
      .prepare("SELECT amount FROM usage WHERE workspace=? AND period_start=?")
      .get(w.id, w.period_start)?.amount || 0
  );
}
export function overview(w) {
  return {
    ...w,
    limits: plans[w.plan],
    used: usage(w),
    active: active(w),
    contact_count: db
      .prepare("SELECT COUNT(*) n FROM contacts WHERE user=?")
      .get(w.id).n,
  };
}
export function createWorkspace(id, name) {
  const now = Date.now();
  db.prepare("INSERT INTO workspaces VALUES(?,?,?,?,?,?,?)").run(
    id,
    name,
    "trial",
    "active",
    now,
    now + 7 * 86400000,
    now,
  );
  db.prepare("INSERT INTO members VALUES(?,?,?)").run(id, id, "owner");
}
export function reserve(w, count) {
  requireActive(w);
  const used = usage(w);
  ensure(
    used + count <= plans[w.plan].messages,
    402,
    "Kuota periode ini tidak mencukupi",
  );
  db.prepare(
    "INSERT INTO usage VALUES(?,?,?) ON CONFLICT(workspace,period_start) DO UPDATE SET amount=amount+excluded.amount",
  ).run(w.id, w.period_start, count);
}
export function settleInvoice(invoiceId, actor, reference) {
  return transaction(() => {
    const invoice = db
      .prepare("SELECT * FROM invoices WHERE id=?")
      .get(invoiceId);
    ensure(invoice, 404, "Invoice tidak ditemukan");
    if (invoice.status === "paid") return invoice;
    ensure(
      ["pending", "review"].includes(invoice.status) &&
        invoice.expires > Date.now(),
      409,
      "Invoice tidak bisa diaktifkan",
    );
    const w = workspace(invoice.workspace);
    ensure(w.status !== "suspended", 409, "Aktifkan workspace dahulu");
    // A renewal starts a new period. The UI accepts renewal only after the current period ends.
    ensure(
      !active(w) || w.plan === "trial",
      409,
      "Periode berbayar masih aktif; tunggu hingga berakhir untuk perpanjangan",
    );
    db.prepare(
      "UPDATE campaigns SET status='cancelled' WHERE user=? AND status IN ('queued','running','paused')",
    ).run(w.id);
    const now = Date.now();
    db.prepare(
      "UPDATE workspaces SET plan=?,period_start=?,period_end=? WHERE id=?",
    ).run(invoice.plan, now, now + plans[invoice.plan].days * 86400000, w.id);
    db.prepare(
      "UPDATE invoices SET status='paid',paid=?,reference=? WHERE id=?",
    ).run(now, reference, invoiceId);
    db.prepare(
      "UPDATE invoices SET status='cancelled' WHERE workspace=? AND id<>? AND status IN ('pending','review')",
    ).run(w.id, invoiceId);
    audit(w.id, actor, "invoice.paid", {
      invoice: invoiceId,
      plan: invoice.plan,
      reference,
    });
    return db.prepare("SELECT * FROM invoices WHERE id=?").get(invoiceId);
  });
}
export function newInvoice(w, plan) {
  ensure(
    typeof plan === "string" && Object.hasOwn(plans, plan) && plan !== "trial",
    400,
    "Paket tidak valid",
  );
  ensure(w.status !== "suspended", 403, "Workspace dinonaktifkan");
  ensure(
    !active(w) || w.plan === "trial",
    409,
    "Perpanjangan tersedia setelah periode berbayar berakhir",
  );
  return transaction(() => {
    const previous = db
      .prepare(
        "SELECT * FROM invoices WHERE workspace=? AND status IN ('pending','review') AND expires>? ORDER BY created DESC LIMIT 1",
      )
      .get(w.id, Date.now());
    if (previous) {
      ensure(
        previous.plan === plan,
        409,
        "Selesaikan atau batalkan invoice yang masih terbuka",
      );
      return previous;
    }
    const now = Date.now(),
      id = randomUUID();
    db.prepare(
      "INSERT INTO invoices(id,workspace,plan,amount,status,created,expires) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      w.id,
      plan,
      plans[plan].price,
      "pending",
      now,
      now + 2 * 86400000,
    );
    return db.prepare("SELECT * FROM invoices WHERE id=?").get(id);
  });
}
