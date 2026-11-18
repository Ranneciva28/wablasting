const notice = document.querySelector("#setup-notice"),
  form = document.querySelector("#setup-form");
const token = location.hash.match(/^#key=([a-f0-9]{64})$/)?.[1];
history.replaceState(null, "", "/setup");
if (!token) {
  form.hidden = true;
  document.querySelector("#setup-help").hidden = false;
}
fetch("/api/setup/status")
  .then((r) => r.json())
  .then((s) => {
    if (!s.required) {
      form.hidden = true;
      notice.textContent =
        "Setup awal sudah selesai. Masuk melalui halaman aplikasi.";
      const a = document.createElement("a");
      a.href = "/app";
      a.textContent = "Buka aplikasi";
      notice.append(document.createElement("br"), a);
    }
  })
  .catch(() => (notice.textContent = "Status setup belum dapat dimuat."));
form.onsubmit = async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.confirm) {
    notice.textContent = "Ulangi password yang sama.";
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/setup/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "wablasting",
        "X-Setup-Key": token,
      },
      body: JSON.stringify({ email: values.email, password: values.password }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Setup gagal");
    location.assign("/app#platform");
  } catch (error) {
    notice.textContent = error.message;
    button.disabled = false;
  }
};
