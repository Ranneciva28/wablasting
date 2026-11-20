const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const selected = new Set();
let me,
  w,
  publicConfig,
  register = location.hash === "#register",
  panel = "overview",
  contactsPage = [],
  templates = [],
  contactOffset = 0,
  campaignOffset = 0,
  detailOffset = 0,
  detailId,
  auditOffset = 0,
  suppressOffset = 0,
  adminOffset = 0,
  requestKey = crypto.randomUUID(),
  pendingReset,
  noticeTimer;
let workspaceId = localStorage.getItem("workspace") || "",
  polling = false;

/* ---------- Human labels for system states ---------- */
const STATUS = {
  campaign: {
    queued: ["Antre", ""],
    running: ["Mengirim", "live"],
    paused: ["Dijeda", "warn"],
    completed: ["Selesai", "ok"],
    cancelled: ["Dibatalkan", ""],
  },
  delivery: {
    pending: ["Antre", ""],
    sending: ["Mengirim", "live"],
    sent: ["Terkirim", "ok"],
    unknown: ["Belum pasti", "warn"],
    skipped: ["Dilewati", ""],
    failed: ["Gagal", "bad"],
  },
  invoice: {
    pending: ["Menunggu pembayaran", "warn"],
    review: ["Sedang diperiksa", "live"],
    paid: ["Lunas", "ok"],
    cancelled: ["Dibatalkan", ""],
    rejected: ["Ditolak", "bad"],
    expired: ["Kedaluwarsa", ""],
  },
  whatsapp: {
    disconnected: ["Belum terhubung", ""],
    connecting: ["Menghubungkan", "live"],
    qr: ["Menunggu scan QR", "warn"],
    connected: ["Terhubung", "ok"],
    reconnecting: ["Menyambung ulang", "live"],
    logged_out: ["Keluar dari perangkat", "bad"],
    error: ["Gagal terhubung", "bad"],
  },
  workspace: {
    active: ["Aktif", "ok"],
    suspended: ["Dinonaktifkan", "bad"],
  },
};
const ROLES = { owner: "Owner", admin: "Admin", operator: "Operator" };
const AUDIT = {
  "campaign.created": "Campaign dibuat",
  "campaign.paused": "Campaign dijeda",
  "campaign.resumed": "Campaign dilanjutkan",
  "campaign.cancelled": "Campaign dibatalkan",
  "contact.saved": "Kontak disimpan",
  "contact.deleted": "Kontak dihapus",
  "contacts.imported": "Kontak diimpor",
  "contact.optout": "Nomor ditambahkan ke opt-out",
  "contact.inbound_optout": "Pelanggan membalas STOP",
  "contact.resubscribed": "Nomor dipulihkan dari opt-out",
  "whatsapp.connect": "WhatsApp dihubungkan",
  "whatsapp.disconnect": "WhatsApp diputus",
  "workspace.updated": "Profil workspace diubah",
  "invoice.paid": "Invoice lunas",
};
function pill(kind, status) {
  const [label, tone] = STATUS[kind]?.[status] || [status, ""];
  const n = el("span", label, "pill");
  if (tone) n.dataset.tone = tone;
  return n;
}
function initials(name) {
  return (
    String(name || "?")
      .trim()
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?"
  );
}
function meter(value, max, warnHigh = false) {
  const m = el("div", null, "meter"),
    bar = el("span");
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  bar.style.width = `${Math.round(ratio * 100)}%`;
  if (warnHigh && ratio >= 0.85) m.dataset.level = "high";
  m.setAttribute("role", "img");
  m.setAttribute("aria-label", `${Math.round(ratio * 100)}% terpakai`);
  m.append(bar);
  return m;
}

/* ---------- Basics ---------- */
function notify(message, tone) {
  const n = $("#notice");
  n.textContent = message;
  if (tone) n.dataset.tone = tone;
  else delete n.dataset.tone;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      if (n.textContent === message) n.textContent = "";
    },
    tone === "bad" ? 12000 : 7000,
  );
}
$("#notice").onclick = () => ($("#notice").textContent = "");
async function api(path, { body, method, headers, ...options } = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "wablasting",
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Error(
      `Respons server kosong atau bukan JSON (HTTP ${response.status}). Periksa aplikasi dan reverse proxy.`,
    );
  }

  if (!response.ok) {
    if (response.status === 401 && me) {
      me = null;
      location.assign("/app");
    }
    throw Error(data.error || "Request gagal");
  }
  return data;
}
async function run(fn) {
  try {
    await fn();
  } catch (error) {
    notify(error.message, "bad");
  }
}
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function button(label, fn, cls) {
  const b = el("button", label, cls);
  b.type = "button";
  b.onclick = () =>
    run(async () => {
      b.disabled = true;
      try {
        await fn();
      } finally {
        b.disabled = false;
      }
    });
  return b;
}
// meta: array of strings/nodes shown under the title; extra: optional nodes below it
function row(title, meta = [], actions = [], { lead, extra } = {}) {
  const node = el("div", null, "row"),
    main = el("div", null, "row-main"),
    text = el("div", null, "row-text");
  if (lead) main.append(lead);
  text.append(el("div", title, "row-title"));
  const items = (Array.isArray(meta) ? meta : [meta]).filter(
    (m) => m !== null && m !== undefined && m !== "",
  );
  if (items.length) {
    const m = el("div", null, "meta");
    for (const item of items)
      m.append(item instanceof Node ? item : el("span", item));
    text.append(m);
  }
  if (extra) text.append(...[].concat(extra));
  main.append(text);
  node.append(main);
  if (actions.length) {
    const right = el("div", null, "actions");
    right.append(...actions);
    node.append(right);
  }
  return node;
}
function empty(node, message) {
  node.replaceChildren();
  node.append(el("p", message, "muted"));
}
function form(id, fn) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    run(async () => {
      try {
        await fn(Object.fromEntries(new FormData(e.target)), e.target);
      } finally {
        b.disabled = false;
      }
    });
  };
}
function date(value) {
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function day(value) {
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function money(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}
const num = (v) => Number(v || 0).toLocaleString("id-ID");
async function confirmAction(title, description, field, ok = "Lanjutkan") {
  const d = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  $("#confirm-label").hidden = !field;
  $("#confirm-label").firstChild.textContent = field || "";
  $("#confirm-value").value = "";
  $("#confirm-ok").textContent = ok;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) =>
    d.addEventListener(
      "close",
      () =>
        resolve(
          d.returnValue === "confirm"
            ? field
              ? $("#confirm-value").value
              : true
            : null,
        ),
      { once: true },
    ),
  );
}

/* ---------- Auth ---------- */
function authMode() {
  $("#auth-title").textContent = register
    ? "Buat akun WABlast"
    : "Masuk ke workspace";
  $("#auth-lead").textContent = register
    ? "Trial 7 hari langsung aktif. Tanpa kartu kredit."
    : "Masuk untuk mengelola kontak dan campaign.";
  $("#registration-fields").hidden = !register;
  $("#auth-submit").textContent = register ? "Buat akun & mulai trial" : "Masuk";
  $("#auth-toggle").textContent = register
    ? "Sudah punya akun? Masuk"
    : "Belum punya akun? Daftar";
  $("#login [name=acceptTerms]").required = register;
  $("#login [name=company]").required = register;
  $("#login [name=password]").autocomplete = register
    ? "new-password"
    : "current-password";
}
$("#auth-toggle").onclick = () => {
  register = !register;
  authMode();
};
$("#forgot-toggle").onclick = () => {
  $("#auth").hidden = true;
  $("#forgot").hidden = false;
};
$("#forgot-back").onclick = () => {
  $("#forgot").hidden = true;
  $("#auth").hidden = false;
};
form("#login", async (d, f) => {
  await api("/auth/" + (register ? "register" : "login"), {
    body: { ...d, acceptTerms: d.acceptTerms === "on" },
  });
  f.reset();
  await session();
  notify(
    register
      ? "Akun dibuat. Verifikasi email untuk mulai mengirim."
      : "Selamat datang kembali.",
  );
});
form("#forgot-form", async (d) => {
  const r = await api("/auth/forgot", { body: d });
  notify(r.message);
});
form("#reset-form", async (d) => {
  await api("/auth/reset", { body: { ...d, token: pendingReset } });
  pendingReset = null;
  $("#reset").hidden = true;
  $("#auth").hidden = false;
  notify("Password diperbarui. Silakan masuk.");
});
$("#logout").onclick = () =>
  run(async () => {
    await api("/logout", { body: {} });
    location.assign("/app");
  });
$("#resend-verify").onclick = () =>
  run(async () => {
    await api("/account/verify", { body: {} });
    notify("Email verifikasi dijadwalkan untuk dikirim.");
  });
async function session() {
  let user;
  try {
    user = await api("/me");
  } catch {
    authMode();
    return;
  }
  me = user;
  document.body.classList.add("signed-in");
  const valid = me.workspaces.some((s) => s.id === workspaceId);
  if (!valid) workspaceId = me.workspaces[0]?.id || me.id;
  localStorage.setItem("workspace", workspaceId);
  $("#auth").hidden = true;
  $("#forgot").hidden = true;
  $("#workspace").hidden = false;
  $("#navigation").hidden = false;
  $("#logout").hidden = false;
  $("#workspace-switch-label").hidden = me.workspaces.length < 2;
  const select = $("#workspace-switch");
  select.replaceChildren();
  for (const item of me.workspaces) {
    const option = el("option", item.name);
    option.value = item.id;
    option.selected = item.id === workspaceId;
    select.append(option);
  }
  $("#admin-nav").hidden = !me.superAdmin;
  $("#platform-nav").hidden = !me.superAdmin;
  $("#platform-group").hidden = !me.superAdmin;
  $("#identity").textContent = me.email;
  $("#avatar").textContent = initials(me.email);
  $("#verify-banner").hidden = Boolean(me.verified);
  const invite = sessionStorage.getItem("pendingInvite");
  if (invite && me.verified) {
    try {
      const result = await api("/invites/accept", { body: { token: invite } });
      sessionStorage.removeItem("pendingInvite");
      workspaceId = result.id;
      localStorage.setItem("workspace", workspaceId);
      notify("Undangan diterima.");
      return session();
    } catch (e) {
      sessionStorage.removeItem("pendingInvite");
      notify(e.message, "bad");
    }
  }
  await workspace();
  await navigate();
}
$("#workspace-switch").onchange = () =>
  run(async () => {
    workspaceId = $("#workspace-switch").value;
    localStorage.setItem("workspace", workspaceId);
    selected.clear();
    contactOffset = 0;
    campaignOffset = 0;
    await workspace();
    await navigate();
  });

/* ---------- Workspace overview ---------- */
async function workspace() {
  w = await api("/workspace");
  const management = ["owner", "admin"].includes(w.role);
  $$("[data-management]").forEach((n) => (n.hidden = !management));
  $$("[data-owner]").forEach((n) => (n.hidden = w.role !== "owner"));
  $("#workspace-form [name=name]").value = w.name;
  const summary = $("#workspace-summary");
  summary.replaceChildren(
    el("span", w.name),
    el("span", `Paket ${w.limits.name}`),
    pill("workspace", w.active ? "active" : "suspended"),
    el("span", `Berlaku hingga ${day(w.period_end)}`),
    el("span", `Role kamu: ${ROLES[w.role] || w.role}`),
  );
  if (!w.active) summary.children[2].textContent = "Tidak aktif";
  const stats = $("#stats");
  stats.replaceChildren();
  const remaining = Math.max(
    0,
    Math.ceil((w.period_end - Date.now()) / 86400000),
  );
  for (const [label, value, note, bar] of [
    [
      "Kuota penerima",
      `${num(w.used)} / ${num(w.limits.messages)}`,
      `Sisa ${num(Math.max(0, w.limits.messages - w.used))} penerima periode ini`,
      [w.used, w.limits.messages],
    ],
    [
      "Kontak",
      `${num(w.contact_count)} / ${num(w.limits.contacts)}`,
      "Tersimpan di workspace ini",
      [w.contact_count, w.limits.contacts],
    ],
    [
      `Paket ${w.limits.name}`,
      w.active ? `${remaining} hari lagi` : "Tidak aktif",
      `Berakhir ${day(w.period_end)}`,
      null,
    ],
  ]) {
    const card = el("div", null, "stat");
    card.append(el("small", label), el("strong", value));
    if (bar) card.append(meter(...bar, true));
    card.append(el("span", note));
    stats.append(card);
  }
  hint();
}
const titles = {
  overview: ["Ringkasan", "Pemakaian dan status workspace kamu."],
  connection: ["WhatsApp", "Tautkan nomor yang dipakai untuk mengirim pesan."],
  contacts: ["Kontak", "Pelanggan yang sudah setuju menerima pesan."],
  campaigns: ["Campaign", "Tulis pesan, pilih penerima, dan pantau pengiriman."],
  templates: ["Template", "Pesan siap pakai untuk campaign berikutnya."],
  team: ["Tim", "Siapa saja yang bisa mengakses workspace ini."],
  billing: ["Langganan", "Paket, invoice, dan cara pembayaran."],
  audit: ["Aktivitas", "Riwayat perubahan penting di workspace."],
  settings: ["Pengaturan", "Profil workspace dan keamanan akun."],
  admin: ["Pelanggan & pembayaran", "Verifikasi pembayaran dan kelola workspace pelanggan."],
  platform: ["Pengaturan platform", "Brand, email, rekening, dan harga layanan."],
};
async function navigate() {
  const target = location.hash.slice(1);
  panel = titles[target] ? target : "overview";
  if (["admin", "platform"].includes(panel) && !me?.superAdmin)
    panel = "overview";
  if (["team", "audit"].includes(panel) && w?.role === "operator")
    panel = "overview";
  $$("[data-panel]").forEach((n) => (n.hidden = n.dataset.panel !== panel));
  $$("#navigation a").forEach((n) => {
    const active = n.hash === "#" + panel;
    n.classList.toggle("active", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  $("#page-title").textContent = titles[panel][0];
  $("#page-sub").textContent = titles[panel][1];
  document.title = `${titles[panel][0]} — ${publicConfig?.brand || "WABlast"}`;
  if (!me) return;
  const loaders = {
    overview: workspace,
    connection,
    contacts: async () => {
      await contacts();
      await suppressions();
    },
    campaigns: async () => {
      await loadTemplates();
      await campaigns();
      preview();
    },
    templates: loadTemplates,
    team,
    billing,
    audit: loadAudit,
    admin: loadAdmin,
    platform: loadPlatform,
  };
  if (loaders[panel]) await loaders[panel]();
}
window.addEventListener("hashchange", () => {
  if (me) run(navigate);
});

/* ---------- WhatsApp ---------- */
async function connection() {
  const wa = await api("/whatsapp");
  const [label, tone] = STATUS.whatsapp[wa.state] || [wa.state, ""];
  const badge = $("#wa-state");
  badge.textContent = label;
  if (tone) badge.dataset.tone = tone;
  else delete badge.dataset.tone;
  $("#wa-phone").textContent = wa.phone ? `Terhubung sebagai +${wa.phone}` : "";
  $("#qr").hidden = !wa.qr;
  $("#qr-empty").hidden = Boolean(wa.qr);
  if (wa.qr) $("#qr").src = wa.qr;
  else $("#qr").removeAttribute("src");
  $("#qr-empty-text").textContent =
    wa.state === "connected"
      ? "Nomor sudah tertaut. Kamu siap mengirim campaign."
      : ["connecting", "reconnecting", "qr"].includes(wa.state)
        ? "Menyiapkan QR… halaman ini diperbarui otomatis."
        : "QR muncul di sini setelah kamu klik Hubungkan WhatsApp.";
  $("#connect").disabled =
    !me.verified ||
    !w.active ||
    !["disconnected", "logged_out", "error"].includes(wa.state);
}
$("#connect").onclick = () =>
  run(async () => {
    await api("/whatsapp/connect", { body: {} });
    await connection();
  });
$("#disconnect").onclick = () =>
  run(async () => {
    if (
      !(await confirmAction(
        "Putuskan WhatsApp?",
        "Sesi akan dihapus. Kamu perlu scan QR lagi untuk menghubungkan kembali.",
        null,
        "Putuskan",
      ))
    )
      return;
    await api("/whatsapp/disconnect", { body: {} });
    await connection();
  });

/* ---------- Contacts ---------- */
function hint() {
  const text = `${selected.size} kontak dipilih · Maksimal ${num(w?.limits.batch)} penerima per campaign · Sisa kuota ${num(Math.max(0, (w?.limits.messages || 0) - (w?.used || 0)))}`;
  $("#selected-count").textContent = text;
  $("#campaign-hint").textContent = text;
  preview();
}
async function contacts() {
  contactsPage = await api("/contacts?offset=" + contactOffset);
  const node = $("#contact-list");
  node.replaceChildren();
  if (!contactsPage.length)
    empty(
      node,
      contactOffset
        ? "Tidak ada kontak lagi di halaman ini."
        : "Belum ada kontak. Tambah kontak atau impor CSV di sebelah kanan.",
    );
  for (const c of contactsPage) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = selected.has(c.id);
    cb.disabled = !c.optin;
    cb.onchange = () => {
      cb.checked ? selected.add(c.id) : selected.delete(c.id);
      hint();
    };
    const label = el("label", null, "check");
    const who = el("span");
    const name = el("span", c.name, "contact-name");
    name.append(el("small", `+${c.phone}`));
    who.append(el("span", initials(c.name), "contact-avatar"), name);
    if (!c.optin) {
      const tag = el("span", "Opt-out", "pill");
      tag.dataset.tone = "bad";
      who.append(tag);
    }
    label.append(cb, who);
    const r = el("div", null, "row");
    r.append(
      label,
      button("Hapus", async () => {
        if (
          !(await confirmAction(
            "Hapus kontak?",
            `${c.name} akan dihapus dari workspace ini.`,
            null,
            "Hapus",
          ))
        )
          return;
        await api("/contacts/" + c.id, { method: "DELETE" });
        selected.delete(c.id);
        await contacts();
        await workspace();
      }),
    );
    node.append(r);
  }
  $("#contacts-prev").disabled = contactOffset === 0;
  $("#contacts-next").disabled = contactsPage.length < 100;
  hint();
}
$("#select-page").onclick = () => {
  for (const c of contactsPage)
    if (c.optin && selected.size < w.limits.batch) selected.add(c.id);
  run(contacts);
};
$("#contacts-prev").onclick = () => {
  contactOffset = Math.max(0, contactOffset - 100);
  run(contacts);
};
$("#contacts-next").onclick = () => {
  contactOffset += 100;
  run(contacts);
};
form("#contact-form", async (d, f) => {
  await api("/contacts", { body: { ...d, optin: d.optin === "on" } });
  f.reset();
  await contacts();
  await workspace();
  notify("Kontak disimpan.");
});
form("#import-form", async (d, f) => {
  if (d.file.size > 200000) throw Error("File CSV maksimal 200 KB");
  const result = await api("/contacts/import", {
    body: {
      csv: await d.file.text(),
      source: d.source,
      optin: d.optin === "on",
    },
  });
  f.reset();
  contactOffset = 0;
  await contacts();
  await workspace();
  notify(`${result.count} kontak berhasil diimpor.`);
});
form("#suppress-form", async (d, f) => {
  await api("/suppressions", { body: d });
  f.reset();
  selected.clear();
  await contacts();
  await suppressions();
  notify("Nomor masuk daftar opt-out.");
});
async function suppressions() {
  const data = await api("/suppressions?offset=" + suppressOffset),
    node = $("#suppressions");
  node.replaceChildren();
  if (!data.length) empty(node, "Belum ada nomor di daftar opt-out.");
  for (const s of data)
    node.append(
      row(
        "+" + s.phone,
        [`Sejak ${date(s.created)}`],
        w.role !== "operator"
          ? [
              button("Pulihkan", async () => {
                const source = await confirmAction(
                  "Pulihkan nomor ini?",
                  "Lakukan hanya jika pelanggan sudah memberi persetujuan baru. Catat dari mana persetujuan itu.",
                  "Sumber persetujuan baru",
                  "Pulihkan",
                );
                if (!source) return;
                await api("/suppressions/" + s.phone, {
                  method: "DELETE",
                  body: { source },
                });
                await suppressions();
                await contacts();
              }),
            ]
          : [],
      ),
    );
  $("#suppress-more").disabled = data.length < 100;
}
$("#suppress-more").onclick = () => {
  suppressOffset += 100;
  run(suppressions);
};

/* ---------- Campaigns ---------- */
function preview() {
  const box = $("#preview");
  if (!box) return;
  const message = $("#campaign-form [name=message]").value;
  const first = contactsPage.find((c) => selected.has(c.id));
  const name = first?.name || "Rani";
  $("#preview-to").textContent = `Seperti yang diterima ${name}.`;
  box.replaceChildren();
  const parts = message.split(/(\{\{\s*nama\s*\}\})/i);
  for (const part of parts) {
    if (/^\{\{\s*nama\s*\}\}$/i.test(part)) box.append(el("mark", name));
    else if (part) box.append(document.createTextNode(part));
  }
}
$("#campaign-form [name=message]").addEventListener("input", preview);
form("#campaign-form", async (d, f) => {
  const body = {
    ...d,
    contacts: [...selected],
    scheduled: d.scheduled ? new Date(d.scheduled).getTime() : null,
  };
  await api("/campaigns", { body, headers: { "Idempotency-Key": requestKey } });
  requestKey = crypto.randomUUID();
  f.reset();
  selected.clear();
  await campaigns();
  await workspace();
  notify("Campaign masuk antrean.");
});
async function campaigns() {
  const data = await api("/campaigns?offset=" + campaignOffset),
    node = $("#campaign-list");
  node.replaceChildren();
  if (!data.length)
    empty(
      node,
      campaignOffset
        ? "Tidak ada campaign lagi."
        : "Belum ada campaign. Pilih kontak, tulis pesan, lalu klik Mulai campaign.",
    );
  for (const c of data) {
    const actions = [
      button("Detail", async () => {
        detailId = c.id;
        detailOffset = 0;
        await details();
        $("#details-section").scrollIntoView({ block: "start" });
      }),
    ];
    if (!["completed", "cancelled"].includes(c.status)) {
      const action = c.status === "paused" ? "resume" : "pause";
      actions.push(
        button(action === "resume" ? "Lanjutkan" : "Jeda", async () => {
          await api(`/campaigns/${c.id}/${action}`, { body: {} });
          await campaigns();
        }),
        button(
          "Batalkan",
          async () => {
            if (
              !(await confirmAction(
                "Batalkan campaign?",
                "Pesan berikutnya tidak akan dikirim. Satu pesan yang sedang diproses mungkin sudah terkirim. Kuota tetap terpakai.",
                null,
                "Batalkan campaign",
              ))
            )
              return;
            await api(`/campaigns/${c.id}/cancel`, { body: {} });
            await campaigns();
          },
          "danger",
        ),
      );
    }
    const total = Number(c.total || 0),
      sent = Number(c.sent || 0),
      unknown = Number(c.unknown_count || 0);
    node.append(
      row(
        c.name,
        [
          pill("campaign", c.status),
          `${num(sent)} dari ${num(total)} terkirim`,
          unknown ? `${num(unknown)} belum pasti` : null,
          c.scheduled ? `Dijadwalkan ${date(c.scheduled)}` : `Dibuat ${date(c.created)}`,
        ],
        actions,
        { extra: meter(sent, total) },
      ),
    );
  }
  $("#campaigns-prev").disabled = campaignOffset === 0;
  $("#campaigns-next").disabled = data.length < 50;
}
$("#campaigns-prev").onclick = () => {
  campaignOffset = Math.max(0, campaignOffset - 50);
  run(campaigns);
};
$("#campaigns-next").onclick = () => {
  campaignOffset += 50;
  run(campaigns);
};
async function details() {
  const c = await api(`/campaigns/${detailId}?offset=${detailOffset}`);
  $("#details-section").hidden = false;
  $("#details-title").textContent = `Penerima: ${c.name}`;
  const n = $("#details");
  n.replaceChildren();
  if (!c.deliveries.length) empty(n, "Tidak ada penerima di halaman ini.");
  for (const d of c.deliveries)
    n.append(
      row(d.name, [pill("delivery", d.status), `+${d.phone}`, d.error], [], {
        lead: el("span", initials(d.name), "contact-avatar"),
      }),
    );
  $("#details-prev").disabled = detailOffset === 0;
  $("#details-next").disabled = c.deliveries.length < 100;
}
$("#details-prev").onclick = () => {
  detailOffset = Math.max(0, detailOffset - 100);
  run(details);
};
$("#details-next").onclick = () => {
  detailOffset += 100;
  run(details);
};

/* ---------- Templates ---------- */
async function loadTemplates() {
  templates = await api("/templates");
  const n = $("#template-list"),
    picker = $("#template-picker");
  n.replaceChildren();
  picker.replaceChildren(el("option", "Tulis pesan baru"));
  picker.firstChild.value = "";
  if (!templates.length)
    empty(n, "Belum ada template. Simpan pesan yang sering kamu kirim.");
  for (const t of templates) {
    n.append(
      row(
        t.name,
        [],
        [
          button(
            "Pakai",
            async () => {
              location.hash = "campaigns";
              $("#template-picker").value = t.id;
              $("#campaign-form [name=message]").value = t.message;
              preview();
            },
          ),
          button("Hapus", async () => {
            if (
              !(await confirmAction(
                "Hapus template?",
                `Template “${t.name}” akan dihapus.`,
                null,
                "Hapus",
              ))
            )
              return;
            await api("/templates/" + t.id, { method: "DELETE" });
            await loadTemplates();
          }),
        ],
        { extra: el("div", t.message, "row-body") },
      ),
    );
    const option = el("option", t.name);
    option.value = t.id;
    picker.append(option);
  }
}
$("#template-picker").onchange = () => {
  const t = templates.find((t) => t.id === $("#template-picker").value);
  if (t) $("#campaign-form [name=message]").value = t.message;
  preview();
};
form("#template-form", async (d, f) => {
  await api("/templates", { body: d });
  f.reset();
  await loadTemplates();
  notify("Template disimpan.");
});

/* ---------- Team ---------- */
async function team() {
  const data = await api("/team"),
    n = $("#team-list"),
    inv = $("#invite-list");
  n.replaceChildren();
  inv.replaceChildren();
  for (const member of data.members) {
    const actions = [];
    if (w.role === "owner" && member.role !== "owner") {
      actions.push(
        button(
          member.role === "admin" ? "Jadikan operator" : "Jadikan admin",
          async () => {
            await api("/team/" + member.id, {
              method: "PATCH",
              body: { role: member.role === "admin" ? "operator" : "admin" },
            });
            await team();
          },
        ),
        button(
          "Keluarkan",
          async () => {
            if (
              !(await confirmAction(
                "Keluarkan anggota?",
                `${member.email} tidak bisa lagi mengakses workspace ini.`,
                null,
                "Keluarkan",
              ))
            )
              return;
            await api("/team/" + member.id, { method: "DELETE" });
            await team();
          },
          "danger",
        ),
      );
    }
    n.append(
      row(member.email, [ROLES[member.role] || member.role], actions, {
        lead: el("span", initials(member.email), "contact-avatar"),
      }),
    );
  }
  if (!data.invites.length) empty(inv, "Tidak ada undangan yang tertunda.");
  for (const i of data.invites)
    inv.append(
      row(
        i.email,
        [ROLES[i.role] || i.role, `Berlaku hingga ${date(i.expires)}`],
        w.role === "owner"
          ? [
              button("Cabut undangan", async () => {
                await api("/team/invites/" + encodeURIComponent(i.email), {
                  method: "DELETE",
                });
                await team();
              }),
            ]
          : [],
      ),
    );
}
form("#team-form", async (d, f) => {
  await api("/team/invite", { body: d });
  f.reset();
  await team();
  notify("Undangan dijadwalkan untuk dikirim.");
});

/* ---------- Billing ---------- */
async function billing() {
  const data = await api("/billing");
  const ws = data.workspace;
  $("#billing-summary").replaceChildren(
    el("span", `Paket ${ws.limits.name}`),
    pill("workspace", ws.active ? "active" : "suspended"),
    el("span", `Berlaku hingga ${day(ws.period_end)}`),
    el("span", `${num(ws.used)} / ${num(ws.limits.messages)} kuota terpakai`),
  );
  if (!ws.active) $("#billing-summary").children[1].textContent = "Tidak aktif";
  $("#payment-instructions").textContent =
    data.instructions ||
    "Instruksi pembayaran belum diatur. Hubungi pengelola layanan.";
  const grid = $("#billing-plans");
  grid.replaceChildren();
  for (const [id, p] of Object.entries(publicConfig.plans)) {
    if (id === "trial") continue;
    const current = ws.plan === id && ws.active;
    const card = el("div", null, "plan" + (id === "growth" ? " featured" : ""));
    if (current) card.append(el("span", "Paket kamu", "plan-tag"));
    const list = el("ul");
    for (const t of [
      `${num(p.messages)} penerima per ${p.days} hari`,
      `${num(p.contacts)} kontak`,
      `${p.seats} anggota tim`,
      "1 nomor WhatsApp",
    ])
      list.append(el("li", t));
    card.append(el("h3", p.name), el("strong", money(p.price)), el("small", `per ${p.days} hari`), list);
    if (w.role === "owner")
      card.append(
        button(
          "Buat invoice",
          async () => {
            if (
              !(await confirmAction(
                `Buat invoice ${p.name}?`,
                `${money(p.price)} untuk ${p.days} hari. Paket aktif setelah pembayaran diverifikasi admin.`,
                null,
                "Buat invoice",
              ))
            )
              return;
            await api("/billing/invoices", { body: { plan: id } });
            await billing();
          },
          id === "growth" ? "accent" : "primary",
        ),
      );
    grid.append(card);
  }
  const node = $("#invoice-list");
  node.replaceChildren();
  if (!data.invoices.length) empty(node, "Belum ada invoice.");
  for (const i of data.invoices) {
    const actions = [];
    if (
      w.role === "owner" &&
      ["pending", "review"].includes(i.status) &&
      i.expires > Date.now()
    ) {
      actions.push(
        button(
          "Konfirmasi transfer",
          async () => {
            const reference = await confirmAction(
              "Sudah transfer?",
              "Tulis nama pengirim, bank, dan waktu transfer. Admin akan mencocokkan dengan dana masuk.",
              "Referensi transfer",
              "Kirim konfirmasi",
            );
            if (!reference) return;
            await api(`/billing/invoices/${i.id}/confirm`, {
              body: { reference },
            });
            await billing();
          },
          "primary",
        ),
        button("Batalkan", async () => {
          if (
            !(await confirmAction(
              "Batalkan invoice?",
              `Invoice ${i.id} tidak bisa dibayar lagi setelah dibatalkan.`,
              null,
              "Batalkan invoice",
            ))
          )
            return;
          await api(`/billing/invoices/${i.id}/cancel`, { body: {} });
          await billing();
        }),
      );
    }
    const expired =
      ["pending", "review"].includes(i.status) && i.expires <= Date.now();
    node.append(
      row(
        `${publicConfig.plans[i.plan]?.name} · ${money(i.amount)}`,
        [
          pill("invoice", expired ? "expired" : i.status),
          `Batas bayar ${date(i.expires)}`,
          `ID ${i.id}`,
        ],
        actions,
      ),
    );
  }
}

/* ---------- Audit ---------- */
function auditDetail(raw) {
  try {
    const d = JSON.parse(raw);
    const parts = [];
    if (d.count) parts.push(`${num(d.count)} item`);
    if (d.phone) parts.push(`+${d.phone}`);
    if (d.plan) parts.push(`Paket ${d.plan}`);
    if (d.source) parts.push(`Sumber: ${d.source}`);
    if (d.reference) parts.push(`Ref: ${d.reference}`);
    return parts;
  } catch {
    return [raw];
  }
}
async function loadAudit() {
  const data = await api("/audit?offset=" + auditOffset),
    n = $("#audit-list");
  n.replaceChildren();
  if (!data.length) empty(n, "Belum ada aktivitas.");
  for (const a of data)
    n.append(
      row(AUDIT[a.action] || a.action, [date(a.created), ...auditDetail(a.detail)]),
    );
  $("#audit-more").disabled = data.length < 100;
}
$("#audit-more").onclick = () => {
  auditOffset += 100;
  run(loadAudit);
};

/* ---------- Settings ---------- */
form("#workspace-form", async (d) => {
  await api("/workspace", { method: "PATCH", body: d });
  await session();
  notify("Nama workspace diperbarui.");
});
form("#password-form", async (d) => {
  await api("/account/password", { body: d });
  location.assign("/app");
});
$("#export").onclick = () =>
  run(async () => {
    const data = await api("/export");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = el("a");
    a.href = url;
    a.download = "workspace-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
form("#delete-form", async (d, f) => {
  if (
    !(await confirmAction(
      "Hapus data permanen?",
      "Kontak dan riwayat campaign akan dihapus dan tidak bisa dipulihkan dari aplikasi.",
      null,
      "Hapus permanen",
    ))
  )
    return;
  await api("/workspace/data", { method: "DELETE", body: d });
  selected.clear();
  f.reset();
  await workspace();
  notify("Data operasional dihapus.");
});

/* ---------- Platform admin ---------- */
async function loadAdmin() {
  const data = await api("/admin/overview?offset=" + adminOffset),
    stats = $("#admin-stats");
  stats.replaceChildren();
  const pendingMail = data.mail.filter((m) => m.status !== "sent");
  for (const [label, value, note] of [
    ["Workspace pelanggan", num(data.total), "Termasuk trial"],
    ["Pembayaran terverifikasi", money(data.revenue.amount), "Total invoice lunas"],
    [
      "Email tertunda",
      num(pendingMail.reduce((s, m) => s + m.count, 0)),
      pendingMail.map((m) => `${m.status}: ${m.count}`).join(", ") ||
        "Semua email terkirim",
    ],
  ]) {
    const n = el("div", null, "stat");
    n.append(el("small", label), el("strong", value), el("span", note));
    stats.append(n);
  }
  const invoices = $("#admin-invoices");
  invoices.replaceChildren();
  if (!data.invoices.length) empty(invoices, "Tidak ada pembayaran yang perlu diperiksa.");
  for (const i of data.invoices) {
    const actions = [];
    if (["pending", "review"].includes(i.status) && i.expires > Date.now())
      actions.push(
        button(
          "Setujui",
          async () => {
            const reference = await confirmAction(
              "Aktifkan paket pelanggan?",
              "Pastikan dana sudah masuk ke rekening penerima.",
              "Referensi verifikasi",
              "Setujui & aktifkan",
            );
            if (!reference) return;
            await api("/admin/invoices/" + i.id + "/approve", {
              body: { reference },
            });
            await loadAdmin();
          },
          "primary",
        ),
        button(
          "Tolak",
          async () => {
            const reason = await confirmAction(
              "Tolak invoice?",
              "Pelanggan perlu membuat invoice baru.",
              "Alasan",
              "Tolak invoice",
            );
            if (!reason) return;
            await api("/admin/invoices/" + i.id + "/reject", {
              body: { reason },
            });
            await loadAdmin();
          },
          "danger",
        ),
      );
    invoices.append(
      row(
        `${i.name} · ${money(i.amount)}`,
        [
          pill("invoice", i.status),
          i.reference ? `Ref: ${i.reference}` : "Belum ada referensi",
          `ID ${i.id}`,
        ],
        actions,
      ),
    );
  }
  const n = $("#admin-workspaces");
  n.replaceChildren();
  if (!data.workspaces.length) empty(n, "Belum ada workspace pelanggan.");
  for (const customer of data.workspaces)
    n.append(
      row(
        customer.name,
        [
          pill("workspace", customer.status),
          customer.email,
          `Paket ${publicConfig.plans[customer.plan]?.name || customer.plan}`,
          `Hingga ${day(customer.period_end)}`,
        ],
        [
          button(
            customer.status === "active" ? "Nonaktifkan" : "Aktifkan kembali",
            async () => {
              const status =
                customer.status === "active" ? "suspended" : "active";
              if (
                !(await confirmAction(
                  status === "suspended"
                    ? "Nonaktifkan workspace?"
                    : "Aktifkan kembali workspace?",
                  status === "suspended"
                    ? `${customer.name}: antrean dijeda dan sesi WhatsApp diputus.`
                    : `${customer.name} bisa kembali mengirim pesan.`,
                  null,
                  status === "suspended" ? "Nonaktifkan" : "Aktifkan",
                ))
              )
                return;
              await api(`/admin/workspaces/${customer.id}/status`, {
                body: { status },
              });
              await loadAdmin();
            },
            customer.status === "active" ? "danger" : "",
          ),
        ],
        { lead: el("span", initials(customer.name), "contact-avatar") },
      ),
    );
  $("#admin-prev").disabled = adminOffset === 0;
  $("#admin-next").disabled =
    data.workspaces.length < 100 && data.invoices.length < 100;
}
$("#admin-prev").onclick = () => {
  adminOffset = Math.max(0, adminOffset - 100);
  run(loadAdmin);
};
$("#admin-next").onclick = () => {
  adminOffset += 100;
  run(loadAdmin);
};
setInterval(() => {
  if (!me || document.hidden || polling || $("#confirm-dialog").open) return;
  polling = true;
  run(async () => {
    try {
      if (panel === "connection") await connection();
      if (panel === "campaigns") await campaigns();
      if (panel === "overview") await workspace();
    } finally {
      polling = false;
    }
  });
}, 6000);
async function loadPlatform() {
  const data = await api("/admin/settings"),
    f = $("#platform-form");
  for (const key of [
    "brand",
    "businessName",
    "supportEmail",
    "paymentInstructions",
    "mailFrom",
  ])
    f.elements[key].value = data[key] || "";
  f.elements.publicSignup.checked = data.publicSignup;
  f.elements.smtpEnabled.checked = data.smtp.enabled;
  f.elements.smtpHost.value = data.smtp.host;
  f.elements.smtpPort.value = data.smtp.port;
  f.elements.smtpUsername.value = data.smtp.username;
  f.elements.smtpSecure.checked = data.smtp.secure;
  f.elements.smtpPassword.value = "";
  f.elements.smtpPassword.placeholder = data.smtp.hasPassword
    ? "Sudah tersimpan — kosongkan untuk mempertahankan"
    : "";
  f.elements.priceStarter.value = data.prices.starter;
  f.elements.priceGrowth.value = data.prices.growth;
  f.elements.priceBusiness.value = data.prices.business;
  const ready = $("#platform-readiness");
  ready.replaceChildren();
  for (const [label, ok, okText, noText] of [
    ["Identitas", data.readiness.identity, "lengkap", "belum lengkap"],
    ["Email SMTP", data.readiness.smtp, "siap", "belum diatur"],
    ["Pembayaran", data.readiness.payment, "lengkap", "belum diatur"],
    ["Pendaftaran", data.registrationAvailable, "terbuka", "ditahan"],
  ]) {
    const p = el("span", `${label}: ${ok ? okText : noText}`, "pill");
    p.dataset.tone = ok ? "ok" : "warn";
    ready.append(p);
  }
}
form("#platform-form", async (d) => {
  await api("/admin/settings", {
    method: "PUT",
    body: {
      brand: d.brand,
      businessName: d.businessName,
      supportEmail: d.supportEmail,
      paymentInstructions: d.paymentInstructions,
      mailFrom: d.mailFrom,
      publicSignup: d.publicSignup === "on",
      smtp: {
        enabled: d.smtpEnabled === "on",
        host: d.smtpHost,
        port: Number(d.smtpPort),
        username: d.smtpUsername,
        password: d.smtpPassword,
        secure: d.smtpSecure === "on",
      },
      prices: {
        starter: Number(d.priceStarter),
        growth: Number(d.priceGrowth),
        business: Number(d.priceBusiness),
      },
      currentPassword: d.currentPassword,
    },
  });
  $("#platform-form [name=currentPassword]").value = "";
  publicConfig = await api("/public");
  $$("[data-brand]").forEach((n) => (n.textContent = publicConfig.brand));
  await loadPlatform();
  notify("Pengaturan tersimpan. Tidak perlu restart aplikasi.");
});
$("#platform-test-email").onclick = () =>
  run(async () => {
    const currentPassword = $("#platform-form [name=currentPassword]").value;
    if (!currentPassword)
      throw Error("Isi password akun admin untuk mengirim email tes.");
    const result = await api("/admin/settings/test-email", {
      body: { currentPassword },
    });
    notify(`Email tes terkirim ke ${result.to}. Periksa inbox atau spam.`);
  });

/* ---------- Start ---------- */
async function init() {
  publicConfig = await api("/public");
  $$("[data-brand]").forEach((n) => (n.textContent = publicConfig.brand));
  $$("[data-support]").forEach((n) => {
    n.textContent = publicConfig.supportEmail || "Bantuan";
    n.href = publicConfig.supportEmail
      ? "mailto:" + publicConfig.supportEmail
      : "/";
  });
  $("#invite-code-label").hidden = publicConfig.publicSignup;
  const secret = location.hash.match(/^#(verify|reset|invite)=([a-f0-9]{64})$/);
  if (secret) {
    history.replaceState(null, "", "/app");
    const [, kind, value] = secret;
    if (kind === "verify") {
      await api("/auth/verify", { body: { token: value } });
      notify("Email terverifikasi.");
    }
    if (kind === "reset") {
      pendingReset = value;
      $("#auth").hidden = true;
      $("#reset").hidden = false;
      return;
    }
    if (kind === "invite") {
      sessionStorage.setItem("pendingInvite", value);
      notify(
        "Masuk dengan email penerima undangan. Verifikasi email sebelum menerima undangan.",
      );
    }
  }
  authMode();
  await session();
  if (publicConfig.setupRequired && !me)
    notify(
      "Setup pengelola belum selesai. Buka tautan setup pribadi dari hasil instalasi server.",
      "bad",
    );
}
run(init);
