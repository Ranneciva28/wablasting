import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { db } from "./store.js";
import { config, plans } from "./config.js";
import { canRegister, readiness } from "./settings.js";
import { setup, setupNeeded, ensureSetupKey } from "./bootstrap.js";
import { auth, account, authenticated, rateLimit } from "./auth.js";
import { routes, scope, admin, invitations } from "./routes.js";
import { createWorker, recover } from "./worker.js";
import { deliverMail } from "./mail.js";
import { lockInstance } from "./instance.js";
import { active } from "./saas.js";
import * as wa from "./whatsapp.js";
import { originValues, validOrigins } from "./origin.js";
const unlock = lockInstance();
ensureSetupKey();
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set(
    "trust proxy",
    process.env.TRUST_PROXY.split(",").map((s) => s.trim()),
  );
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "upgrade-insecure-requests": config.production ? [] : null,
      },
    },
  }),
);
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.set("X-Request-Id", req.requestId);
  next();
});
app.get("/health/live", (req, res) => res.json({ ok: true }));
app.get("/health/ready", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.use("/api", rateLimit(600, 60000, "api"));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const origins = originValues(req.rawHeaders);
  res.set("X-Validated-Origin-Count", String(origins.length));
  if (
    !["GET", "HEAD"].includes(req.method) &&
    (req.get("X-Requested-With") !== "wablasting" ||
      !validOrigins(origins, new URL(config.url).origin))
  )
    return res.status(403).json({ error: "Invalid request origin" });
  next();
});
app.use(express.json({ limit: "256kb" }));
app.get("/api/public", (req, res) =>
  res.json({
    brand: config.brand,
    plans,
    publicSignup: canRegister() && (!config.production || !setupNeeded()),
    setupRequired: setupNeeded(),
    serviceReady: Object.values(readiness()).every(Boolean),
    businessName: config.businessName,
    supportEmail: config.supportEmail,
    billingMode: "manual",
  }),
);
app.use("/api/setup", setup);
app.use("/api/auth/register", (req, res, next) => {
  if (config.production && setupNeeded())
    return res
      .status(503)
      .json({ error: "Pengelola belum menyelesaikan setup awal" });
  next();
});
app.use("/api/auth", auth);
app.use("/api", authenticated, account);
app.use("/api/admin", admin);
app.use("/api", invitations);
app.use("/api", scope, routes);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint tidak tersedia" }),
);
app.get("/setup", (req, res) =>
  res.sendFile(fileURLToPath(new URL("../public/setup.html", import.meta.url))),
);
app.get("/app", (req, res) =>
  res.sendFile(fileURLToPath(new URL("../public/app.html", import.meta.url))),
);
app.use(
  express.static(fileURLToPath(new URL("../public", import.meta.url)), {
    index: "index.html",
  }),
);
app.use((err, req, res, next) => {
  const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "request.error",
        requestId: req.requestId,
        type: err.name,
      }),
    );
  res.status(status).json({
    error:
      status >= 500
        ? "Terjadi kesalahan server. Hubungi support dengan Request ID."
        : err.message,
    requestId: req.requestId,
  });
});
recover();
const worker = createWorker(wa);
const timer = setInterval(
  () =>
    worker
      .tick()
      .catch((e) =>
        console.error(JSON.stringify({ event: "worker.error", type: e.name })),
      ),
  config.workerMs,
);
const mailTimer = setInterval(
  () =>
    deliverMail().catch((e) =>
      console.error(JSON.stringify({ event: "mail.error", type: e.name })),
    ),
  10000,
);
const cleanup = setInterval(() => {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
  db.prepare("DELETE FROM tokens WHERE expires<?").run(now);
  db.prepare("DELETE FROM invites WHERE expires<?").run(now);
  db.prepare(
    "UPDATE invoices SET status='expired' WHERE expires<? AND status IN ('pending','review')",
  ).run(now);
  db.prepare(
    "DELETE FROM mail WHERE created<? AND status IN ('sent','failed')",
  ).run(now - 7 * 86400000);
}, 60000);
let stopping = false;
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () => console.log(`WABlast ready on ${server.address().port}`),
);
// Restore linked sessions; campaign recovery never retries ambiguous sends.
for (const w of db
  .prepare(
    "SELECT DISTINCT w.* FROM workspaces w JOIN auth a ON a.user=w.id JOIN users u ON u.id=w.id WHERE u.verified=1 AND a.key='creds'",
  )
  .all())
  if (active(w))
    wa.connect(w.id).catch(() =>
      console.error(
        JSON.stringify({ event: "whatsapp.restore_failed", workspace: w.id }),
      ),
    );
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    worker.stop();
    clearInterval(timer);
    clearInterval(mailTimer);
    clearInterval(cleanup);
    server.close();
    const deadline = Date.now() + 50000;
    const finish = setInterval(() => {
      if (!worker.busy || Date.now() > deadline) {
        clearInterval(finish);
        wa.closeAll();
        db.close();
        unlock();
        process.exit(0);
      }
    }, 100);
  });
