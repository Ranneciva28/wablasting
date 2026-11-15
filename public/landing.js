(async () => {
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
    const year = document.querySelector("#year");
    if (year) year.textContent = new Date().getFullYear();
    const grid = document.querySelector("#pricing-grid");
    if (!grid) return;
    for (const [id, p] of Object.entries(c.plans)) {
      if (id === "trial") continue;
      const card = document.createElement("article");
      card.className = "plan" + (id === "growth" ? " featured" : "");
      const heading = document.createElement("h3");
      heading.textContent = p.name;
      const price = document.createElement("strong");
      price.textContent = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(p.price);
      const period = document.createElement("small");
      period.textContent = "/ 30 hari";
      const list = document.createElement("ul");
      for (const text of [
        `${p.messages.toLocaleString("id-ID")} kuota penerima`,
        `${p.contacts.toLocaleString("id-ID")} kontak`,
        `${p.seats} anggota tim`,
        "1 nomor WhatsApp",
        `${p.batch} penerima per campaign`,
      ]) {
        const li = document.createElement("li");
        li.textContent = text;
        list.append(li);
      }
      const link = document.createElement("a");
      link.href = "/app#register";
      link.className = "button" + (id === "growth" ? " primary" : "");
      link.textContent = "Mulai dengan trial ↗";
      card.append(heading, price, period, list, link);
      grid.append(card);
    }
  } catch {
    const grid = document.querySelector("#pricing-grid");
    if (grid) grid.textContent = "Paket belum dapat dimuat. Silakan coba lagi.";
  }
})();
