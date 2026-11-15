import { config } from "../src/config.js";
import { db } from "../src/store.js";
import { verifyMail } from "../src/mail.js";
try {
  await verifyMail();
  const result = db.prepare("PRAGMA integrity_check").get();
  if (result.integrity_check !== "ok")
    throw Error("Database integrity check failed");
  console.log(
    JSON.stringify({
      database: "ok",
      smtp: config.smtp ? "ok" : "local preview only",
      production: config.production,
      publicSignup: config.publicSignup,
      billing: "manual",
    }),
  );
} finally {
  db.close();
}
