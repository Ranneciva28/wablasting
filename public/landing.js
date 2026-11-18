// Shared by the landing page and the legal pages: brand, footer details and pricing.
const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

function playDemo() {
  const stack = document.querySelector("#demo-stack");
  const count = document.querySelector("#demo-count");
  if (!stack || !count) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const rows = [...stack.querySelectorAll(".msg")];
  const set = (row, state) => {
    const tick = row.querySelector(".tick");
    row.dataset.state = state;
    tick.textContent = { queued: "Antre", sending: "Mengirim…", sent: "Terkirim" }[state];
    if (state === "sent") tick.dataset.tone = "ok";
    else delete tick.dataset.tone;
  };
  rows.forEach((row) => set(row, "queued"));
  count.textContent = "0";
  let sent = 0;
  rows.forEach((row, i) => {
    setTimeout(() => set(row, "sending"), 700 + i * 1100);
    setTimeout(
      () => {
        set(row, "sent");
        count.textContent = String(++sent);
      },
      1400 + i * 1100,
    );
  });
}

function renderPlans(plans) {
  const grid = document.querySelector("#pricing-grid");
  if (!grid) return;
  grid.replaceChildren();
  for (const [id, p] of Object.entries(plans)) {
    if (id === "trial") continue;
    const featured = id === "growth";
    const card = document.createElement("article");
    card.className = "plan" + (featured ? " featured" : "");
    if (featured) {
      const tag = document.createElement("span");
      tag.className = "plan-tag";
      tag.textContent = "Rekomendasi";
      card.append(tag);
    }
    const heading = document.createElement("h3");
    heading.textContent = p.name;
    const price = document.createElement("strong");
    price.textContent = rupiah(p.price);
    const period = document.createElement("small");
    period.textContent = `per ${p.days || 30} hari`;
    const list = document.createElement("ul");
    for (const text of [
      `${p.messages.toLocaleString("id-ID")} penerima per periode`,
      `${p.contacts.toLocaleString("id-ID")} kontak tersimpan`,
      `${p.batch.toLocaleString("id-ID")} penerima per campaign`,
      `${p.seats} anggota tim`,
      "1 nomor WhatsApp",
    ]) {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    }
    const link = document.createElement("a");
    link.href = "/app#register";
    link.className = "button " + (featured ? "accent" : "primary");
    link.textContent = "Mulai trial gratis";
    card.append(heading, price, period, list, link);
    grid.append(card);
  }
}

(async () => {
  const year = document.querySelector("#year");
  if (year) year.textContent = new Date().getFullYear();
  playDemo();
  try {
    const response = await fetch("/api/public");
    if (!response.ok) throw Error("Configuration unavailable");
    const c = await response.json();
    document
      .querySelectorAll("[data-brand]")
      .forEach((n) => (n.textContent = c.brand));
    document
      .querySelectorAll("[data-business]")
      .forEach((n) => (n.textContent = c.businessName || c.brand));
    document.querySelectorAll("[data-support]").forEach((n) => {
      n.textContent = c.supportEmail || "Bantuan";
      n.href = c.supportEmail ? "mailto:" + c.supportEmail : "/app";
    });
    if (c.brand && document.title.includes("WABlast"))
      document.title = document.title.replace("WABlast", c.brand);
    renderPlans(c.plans);
  } catch {
    const grid = document.querySelector("#pricing-grid");
    if (grid)
      grid.textContent =
        "Daftar harga belum bisa dimuat. Muat ulang halaman ini.";
  }
})();
