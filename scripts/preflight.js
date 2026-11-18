import { config } from "../src/config.js";
import { db } from "../src/store.js";
import { verifyMail } from "../src/mail.js";
import { readiness } from "../src/settings.js";
try {
  const result = db.prepare("PRAGMA integrity_check").get();
  if (result.integrity_check !== "ok")
    throw Error("Database integrity check failed");
  if (process.argv.includes("--smtp")) await verifyMail();
  console.log(
    JSON.stringify({
      database: "ok",
      smtp: process.argv.includes("--smtp")
        ? "tested"
        : readiness().smtp
          ? "configured"
          : "setup later in panel",
      production: config.production,
      settings: readiness(),
    }),
  );
} finally {
  db.close();
}
