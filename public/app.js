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
  pendingReset;
let workspaceId = localStorage.getItem("workspace") || "",
  polling = false;
function notify(message) {
  $("#notice").textContent = message;
}
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
  const data = await response.json().catch(() => ({ error: "Request gagal" }));
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
    notify(error.message);
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
function row(title, subtitle, actions = []) {
  const node = el("div", null, "row"),
    left = el("div", title);
  if (subtitle) left.append(el("small", subtitle));
  node.append(left);
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
  return new Date(value).toLocaleString("id-ID");
}
function money(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}
async function confirmAction(title, description, field) {
  const d = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  $("#confirm-label").hidden = !field;
  $("#confirm-label").firstChild.textContent = field || "";
  $("#confirm-value").value = "";
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
function authMode() {
  $("#auth-title").textContent = register
    ? "Buat workspace bisnis"
    : "Masuk ke workspace";
  $("#registration-fields").hidden = !register;
  $("#auth-submit").textContent = register ? "Mulai trial 7 hari" : "Masuk";
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
      ? "Workspace dibuat. Verifikasi email untuk mulai mengirim."
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
  const valid = me.workspaces.some((s) => s.id === workspaceId);
  if (!valid) workspaceId = me.workspaces[0]?.id || me.id;
  localStorage.setItem("workspace", workspaceId);
  $("#auth").hidden = true;
  $("#forgot").hidden = true;
  $("#workspace").hidden = false;
  $("#navigation").hidden = false;
  $("#logout").hidden = false;
  $("#workspace-switch-label").hidden = false;
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
  $("#identity").textContent = me.email;
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
      notify(e.message);
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
async function workspace() {
  w = await api("/workspace");
  const management = ["owner", "admin"].includes(w.role);
  $$("[data-management]").forEach((n) => (n.hidden = !management));
  $$("[data-owner]").forEach((n) => (n.hidden = w.role !== "owner"));
  $("#workspace-form [name=name]").value = w.name;
  $("#workspace-summary").textContent =
    `${w.name} · ${w.limits.name} · ${w.active ? "Aktif" : "Tidak aktif"} hingga ${date(w.period_end)} · ${w.role}`;
  const stats = $("#stats");
  stats.replaceChildren();
  for (const [label, value, note] of [
    [
      "Kuota campaign",
      `${w.used.toLocaleString("id-ID")} / ${w.limits.messages.toLocaleString("id-ID")}`,
      "Penerima teralokasi periode ini",
    ],
    [
      "Kontak",
      `${w.contact_count} / ${w.limits.contacts}`,
      "Tersimpan di workspace",
    ],
    ["Paket", w.limits.name, `Berakhir ${date(w.period_end)}`],
  ]) {
    const card = el("div", null, "stat");
    card.append(el("small", label), el("strong", value), el("span", note));
    stats.append(card);
  }
  hint();
}
const titles = {
  overview: "Ringkasan workspace.",
  connection: "Hubungkan bisnismu.",
  contacts: "Kenali pelangganmu.",
  campaigns: "Pesan yang personal.",
  templates: "Tulis sekali. Pakai lagi.",
  team: "Bekerja bersama.",
  billing: "Tumbuh sesuai kebutuhan.",
  audit: "Setiap perubahan tercatat.",
  settings: "Atur workspace kamu.",
  admin: "Kendali platform.",
  platform: "Pengaturan layanan.",
};
async function navigate() {
  const target = location.hash.slice(1);
  panel = titles[target] ? target : "overview";
  if (["admin", "platform"].includes(panel) && !me?.superAdmin)
    panel = "overview";
  if (["team", "audit"].includes(panel) && w?.role === "operator")
    panel = "overview";
  $$("[data-panel]").forEach((n) => (n.hidden = n.dataset.panel !== panel));
  $$("#navigation a").forEach((n) =>
    n.classList.toggle("active", n.hash === "#" + panel),
  );
  $("#page-title").textContent = titles[panel];
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
async function connection() {
  const wa = await api("/whatsapp");
  $("#wa-state").textContent = wa.state;
  $("#wa-phone").textContent = wa.phone ? `Terhubung: +${wa.phone}` : "";
  $("#qr").hidden = !wa.qr;
  if (wa.qr) $("#qr").src = wa.qr;
  else $("#qr").removeAttribute("src");
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
        "Sesi akan dihapus. Kamu perlu scan QR untuk menghubungkan kembali.",
      ))
    )
      return;
    await api("/whatsapp/disconnect", { body: {} });
    await connection();
  });
function hint() {
  const text = `${selected.size} kontak dipilih · Maksimal ${w?.limits.batch || 0} penerima per campaign · Sisa kuota ${Math.max(0, (w?.limits.messages || 0) - (w?.used || 0))}`;
  $("#selected-count").textContent = text;
  $("#campaign-hint").textContent = text;
}
async function contacts() {
  contactsPage = await api("/contacts?offset=" + contactOffset);
  const node = $("#contact-list");
  node.replaceChildren();
  if (!contactsPage.length) empty(node, "Belum ada kontak pada halaman ini.");
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
    const name = el("span", c.name);
    name.append(el("small", `+${c.phone}${c.optin ? "" : " · Opt-out"}`));
    label.append(cb, name);
    const r = el("div", null, "row");
    r.append(
      label,
      button("Hapus", async () => {
        if (
          !(await confirmAction(
            "Hapus kontak?",
            `Hapus ${c.name} dari workspace?`,
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
  notify(`${result.count} baris berhasil diimpor.`);
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
  if (!data.length) empty(node, "Tidak ada nomor opt-out pada halaman ini.");
  for (const s of data)
    node.append(
      row(
        "+" + s.phone,
        date(s.created),
        w.role !== "operator"
          ? [
              button("Pulihkan", async () => {
                const source = await confirmAction(
                  "Persetujuan baru",
                  "Hanya pulihkan jika pelanggan sudah memberikan persetujuan baru.",
                  "Sumber persetujuan",
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
  if (!data.length) empty(node, "Belum ada campaign pada halaman ini.");
  for (const c of data) {
    const actions = [
      button("Detail", async () => {
        detailId = c.id;
        detailOffset = 0;
        await details();
      }),
    ];
    if (!["completed", "cancelled"].includes(c.status)) {
      const action = c.status === "paused" ? "resume" : "pause";
      actions.push(
        button(action === "resume" ? "Lanjut" : "Jeda", async () => {
          await api(`/campaigns/${c.id}/${action}`, { body: {} });
          await campaigns();
        }),
        button("Batal", async () => {
          if (
            !(await confirmAction(
              "Batalkan campaign?",
              "Pesan berikutnya dihentikan. Satu pesan yang sedang dikirim mungkin sudah terkirim. Kuota tetap teralokasi.",
            ))
          )
            return;
          await api(`/campaigns/${c.id}/cancel`, { body: {} });
          await campaigns();
        }),
      );
    }
    node.append(
      row(
        c.name,
        `${c.status} · ${c.sent || 0}/${c.total} terkirim · ${c.unknown_count || 0} belum pasti${c.scheduled ? " · Jadwal " + date(c.scheduled) : ""}`,
        actions,
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
  $("#details-title").textContent = c.name;
  const n = $("#details");
  n.replaceChildren();
  for (const d of c.deliveries)
    n.append(
      row(d.name, `+${d.phone} · ${d.status}${d.error ? " · " + d.error : ""}`),
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
async function loadTemplates() {
  templates = await api("/templates");
  const n = $("#template-list"),
    picker = $("#template-picker");
  n.replaceChildren();
  picker.replaceChildren(el("option", "Tulis pesan baru"));
  picker.firstChild.value = "";
  for (const t of templates) {
    n.append(
      row(t.name, t.message, [
        button("Hapus", async () => {
          await api("/templates/" + t.id, { method: "DELETE" });
          await loadTemplates();
        }),
      ]),
    );
    const option = el("option", t.name);
    option.value = t.id;
    picker.append(option);
  }
}
$("#template-picker").onchange = () => {
  const t = templates.find((t) => t.id === $("#template-picker").value);
  if (t) $("#campaign-form [name=message]").value = t.message;
};
form("#template-form", async (d, f) => {
  await api("/templates", { body: d });
  f.reset();
  await loadTemplates();
  notify("Template disimpan.");
});
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
        button("Keluarkan", async () => {
          if (!(await confirmAction("Keluarkan anggota?", member.email)))
            return;
          await api("/team/" + member.id, { method: "DELETE" });
          await team();
        }),
      );
    }
    n.append(row(member.email, member.role, actions));
  }
  for (const i of data.invites)
    inv.append(
      row(
        i.email,
        `${i.role} · Berlaku hingga ${date(i.expires)}`,
        w.role === "owner"
          ? [
              button("Cabut", async () => {
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
async function billing() {
  const data = await api("/billing");
  $("#billing-summary").textContent =
    `${data.workspace.limits.name} · ${data.workspace.active ? "Aktif" : "Tidak aktif"} hingga ${date(data.workspace.period_end)} · ${data.workspace.used}/${data.workspace.limits.messages} kuota teralokasi`;
  $("#payment-instructions").textContent =
    data.instructions ||
    "Instruksi pembayaran belum dikonfigurasi. Hubungi pemilik layanan.";
  const grid = $("#billing-plans");
  grid.replaceChildren();
  for (const [id, p] of Object.entries(publicConfig.plans)) {
    if (id === "trial") continue;
    const card = el("div", null, "plan");
    card.append(
      el("h3", p.name),
      el("strong", money(p.price)),
      el(
        "p",
        `${p.messages.toLocaleString("id-ID")} penerima / ${p.days} hari · ${p.seats} anggota · 1 nomor WhatsApp`,
      ),
    );
    if (w.role === "owner")
      card.append(
        button(
          "Buat invoice",
          async () => {
            if (
              !(await confirmAction(
                "Buat invoice " + p.name + "?",
                `${money(p.price)} untuk ${p.days} hari. Aktivasi setelah pembayaran diverifikasi admin.`,
              ))
            )
              return;
            await api("/billing/invoices", { body: { plan: id } });
            await billing();
          },
          "primary",
        ),
      );
    grid.append(card);
  }
  const node = $("#invoice-list");
  node.replaceChildren();
  for (const i of data.invoices) {
    const actions = [];
    if (
      w.role === "owner" &&
      ["pending", "review"].includes(i.status) &&
      i.expires > Date.now()
    ) {
      actions.push(
        button("Konfirmasi transfer", async () => {
          const reference = await confirmAction(
            "Sudah transfer?",
            "Masukkan referensi, nama pengirim dan waktu transfer. Admin akan memeriksa dana masuk.",
            "Referensi transfer",
          );
          if (!reference) return;
          await api(`/billing/invoices/${i.id}/confirm`, {
            body: { reference },
          });
          await billing();
        }),
        button("Batalkan", async () => {
          if (!(await confirmAction("Batalkan invoice?", i.id))) return;
          await api(`/billing/invoices/${i.id}/cancel`, { body: {} });
          await billing();
        }),
      );
    }
    node.append(
      row(
        `${publicConfig.plans[i.plan]?.name} · ${money(i.amount)}`,
        `${i.id} · ${i.status} · Batas bayar ${date(i.expires)}`,
        actions,
      ),
    );
  }
}
async function loadAudit() {
  const data = await api("/audit?offset=" + auditOffset),
    n = $("#audit-list");
  n.replaceChildren();
  for (const a of data)
    n.append(row(a.action, `${date(a.created)} · ${a.detail}`));
  $("#audit-more").disabled = data.length < 100;
}
$("#audit-more").onclick = () => {
  auditOffset += 100;
  run(loadAudit);
};
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
      "Kontak dan riwayat campaign akan dihapus. Data tidak bisa dipulihkan melalui aplikasi.",
    ))
  )
    return;
  await api("/workspace/data", { method: "DELETE", body: d });
  selected.clear();
  f.reset();
  await workspace();
  notify("Data operasional dihapus.");
});
async function loadAdmin() {
  const data = await api("/admin/overview?offset=" + adminOffset),
    stats = $("#admin-stats");
  stats.replaceChildren();
  for (const [label, value] of [
    ["Workspace", data.total],
    ["Pembayaran terverifikasi", money(data.revenue.amount)],
    [
      "Email antre/gagal",
      data.mail
        .filter((m) => m.status !== "sent")
        .map((m) => `${m.status}: ${m.count}`)
        .join(" · ") || "0",
    ],
  ]) {
    const n = el("div", null, "stat");
    n.append(el("small", label), el("strong", value));
    stats.append(n);
  }
  const invoices = $("#admin-invoices");
  invoices.replaceChildren();
  for (const i of data.invoices) {
    const actions = [];
    if (["pending", "review"].includes(i.status) && i.expires > Date.now())
      actions.push(
        button("Setujui", async () => {
          const reference = await confirmAction(
            "Aktifkan paket pelanggan?",
            "Pastikan dana masuk telah diverifikasi pada rekening penerima.",
            "Referensi verifikasi",
          );
          if (!reference) return;
          await api("/admin/invoices/" + i.id + "/approve", {
            body: { reference },
          });
          await loadAdmin();
        }),
        button("Tolak", async () => {
          const reason = await confirmAction(
            "Tolak invoice?",
            "Pelanggan harus membuat invoice baru.",
            "Alasan",
          );
          if (!reason) return;
          await api("/admin/invoices/" + i.id + "/reject", {
            body: { reason },
          });
          await loadAdmin();
        }),
      );
    invoices.append(
      row(
        `${i.name} · ${money(i.amount)} · ${i.status}`,
        `${i.id} · ${i.reference || "Belum ada referensi"}`,
        actions,
      ),
    );
  }
  const n = $("#admin-workspaces");
  n.replaceChildren();
  for (const customer of data.workspaces)
    n.append(
      row(
        customer.name,
        `${customer.email} · ${customer.plan} · ${customer.status} · ${date(customer.period_end)}`,
        [
          button(
            customer.status === "active" ? "Suspend" : "Aktifkan kembali",
            async () => {
              const status =
                customer.status === "active" ? "suspended" : "active";
              if (
                !(await confirmAction(
                  "Ubah status workspace?",
                  `${customer.name} → ${status}`,
                ))
              )
                return;
              await api(`/admin/workspaces/${customer.id}/status`, {
                body: { status },
              });
              await loadAdmin();
            },
          ),
        ],
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
  $("#platform-readiness").textContent =
    `Identitas: ${data.readiness.identity ? "lengkap" : "belum lengkap"} · SMTP: ${data.readiness.smtp ? "terkonfigurasi" : "isi nanti"} · Pembayaran: ${data.readiness.payment ? "lengkap" : "isi nanti"} · Registrasi: ${data.registrationAvailable ? "terbuka" : "ditahan"}`;
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
    );
}
run(init);
