// Read-only probes: no real password, setup token or account mutation is used.
import { config } from "../src/config.js";
import { db } from "../src/store.js";
async function probe(base, method, withOrigin = true) {
  const start = Date.now(),
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      new URL(
        method === "GET" ? "/api/setup/status" : "/api/setup/complete",
        base,
      ),
      {
        method,
        redirect: "manual",
        signal: controller.signal,
        ...(method === "POST"
          ? {
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "wablasting",
                ...(withOrigin ? { Origin: new URL(config.url).origin } : {}),
                "X-Setup-Key": "0".repeat(64),
              },
              body: "{}",
            }
          : {}),
      },
    );
    const raw = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    return {
      method,
      status: response.status,
      json: parsed !== undefined,
      applicationResponse: Boolean(response.headers.get("x-request-id")),
      message: parsed?.error,
      originCopies: response.headers.get("x-validated-origin-count"),
      setupRequired: parsed?.required,
      elapsedMs: Date.now() - start,
    };
  } catch (error) {
    return {
      method,
      error: error.name === "AbortError" ? "timeout" : error.name,
      causeCode: error.cause?.code,
      elapsedMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}
try {
  const internal = `http://127.0.0.1:${process.env.PORT || 3000}`;
  console.log(
    "Memeriksa GET/POST internal dan domain. Maksimal 12 detik per pemeriksaan; tidak menggunakan kredensial asli.",
  );
  // docker compose up -d returns before Node has necessarily opened its listener.
  let startupReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const ready = await fetch(new URL("/health/ready", internal), {
        signal: AbortSignal.timeout(1000),
      });
      if (ready.ok) {
        startupReady = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(
    startupReady
      ? "Listener internal siap."
      : "Listener internal belum siap; diagnostik akan melaporkan kegagalan koneksi.",
  );
  const internalGet = await probe(internal, "GET"),
    internalPost = await probe(internal, "POST");
  const publicGet = await probe(config.url, "GET"),
    publicPost = await probe(config.url, "POST"),
    publicPostWithoutOrigin = await probe(config.url, "POST", false);
  console.log(
    JSON.stringify(
      {
        database: {
          users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
          platformAdmins: db
            .prepare("SELECT COUNT(*) n FROM platform_admins")
            .get().n,
        },
        internal: [internalGet, internalPost],
        public: [publicGet, publicPost],
        controlWithoutOrigin: publicPostWithoutOrigin,
        expected:
          "POST harus menghasilkan HTTP 403 JSON karena kunci uji sengaja tidak valid. Tidak ada akun dibuat.",
        conclusion:
          publicPostWithoutOrigin.status === 403 &&
          publicPostWithoutOrigin.json &&
          !(publicPost.status === 403 && publicPost.json)
            ? "POST tanpa Origin sampai ke aplikasi, tetapi POST dengan Origin gagal. Periksa pemrosesan header Origin di proxy/CDN."
            : internalPost.status === 403 &&
                internalPost.json &&
                !(publicPost.status === 403 && publicPost.json)
              ? "API internal merespons. Periksa reverse proxy/CDN dan log OpenLiteSpeed."
              : internalPost.status === 403 &&
                  publicPost.status === 403 &&
                  publicPost.json
                ? "POST internal dan domain merespons. Periksa pesan setup, origin/cookie, atau gangguan yang terjadi sesekali."
                : "Periksa proses aplikasi/container dan log server.",
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
