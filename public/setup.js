const notice = document.querySelector("#setup-notice"),
  form = document.querySelector("#setup-form");
const token = location.hash.match(/^#key=([a-f0-9]{64})$/)?.[1];
history.replaceState(null, "", "/setup");
function completed() {
  form.hidden = true;
  notice.textContent =
    "Setup admin sudah selesai. Masuk menggunakan email dan password yang kamu buat.";
  const link = document.createElement("a");
  link.href = "/app";
  link.textContent = "Buka halaman login";
  notice.append(document.createElement("br"), link);
}
async function jsonResponse(response) {
  const body = await response.text();
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    if ([502, 503, 504].includes(response.status))
      throw Error(
        `Reverse proxy belum dapat meneruskan permintaan ke aplikasi (HTTP ${response.status}). Periksa diagnostik koneksi server.`,
      );
    throw Error(
      `Respons server kosong atau bukan JSON (HTTP ${response.status}). Periksa aplikasi dan reverse proxy.`,
    );
  }
  if (!response.ok)
    throw Error(value.error || `Permintaan gagal (HTTP ${response.status}).`);
  return value;
}
async function status() {
  return jsonResponse(await fetch("/api/setup/status", { cache: "no-store" }));
}
if (!token) {
  form.hidden = true;
  document.querySelector("#setup-help").hidden = false;
}
status()
  .then((value) => {
    if (!value.required) completed();
  })
  .catch((error) => (notice.textContent = error.message));
form.onsubmit = async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.confirm) {
    notice.textContent = "Ulangi password yang sama.";
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  notice.textContent = "Membuat akun admin…";
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
    const value = await jsonResponse(response);
    if (value.ok !== true)
      throw Error(
        "Respons pembuatan akun tidak lengkap. Periksa status setup.",
      );
    location.assign("/app#platform");
  } catch (error) {
    // A proxy can lose a response after the database commit. Do not claim setup failed or retry blindly.
    let state;
    try {
      state = await status();
    } catch {}
    if (state?.required === false) completed();
    else
      notice.textContent =
        error.message ||
        "Koneksi server terputus. Coba lagi setelah memeriksa koneksi.";
  } finally {
    button.disabled = false;
  }
};
