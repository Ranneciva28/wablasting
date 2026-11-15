import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { db, encrypt, decrypt } from "./store.js";
import { config } from "./config.js";
export function queueMail(to, subject, text) {
  db.prepare(
    "INSERT INTO mail(id,payload,next_attempt,created) VALUES(?,?,?,?)",
  ).run(
    randomUUID(),
    encrypt(JSON.stringify({ to, subject, text })),
    Date.now(),
    Date.now(),
  );
}
const smtp = config.smtp ? new URL(config.smtp) : null;
const transport = smtp
  ? nodemailer.createTransport(
      {
        host: smtp.hostname,
        port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
        secure: smtp.protocol === "smtps:",
        requireTLS: config.production && smtp.protocol !== "smtps:",
        auth: smtp.username
          ? {
              user: decodeURIComponent(smtp.username),
              pass: decodeURIComponent(smtp.password),
            }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      },
      {
        from: config.mailFrom,
        disableFileAccess: true,
        disableUrlAccess: true,
      },
    )
  : null;
export async function verifyMail() {
  if (transport) await transport.verify();
}
let busy = false;
export async function deliverMail() {
  if (!transport || busy) return;
  busy = true;
  try {
    const messages = db
      .prepare(
        "SELECT * FROM mail WHERE status='pending' AND next_attempt<=? ORDER BY created LIMIT 5",
      )
      .all(Date.now());
    for (const mail of messages) {
      try {
        await transport.sendMail(JSON.parse(decrypt(mail.payload)));
        db.prepare(
          "UPDATE mail SET status='sent',payload='',attempts=attempts+1 WHERE id=?",
        ).run(mail.id);
      } catch {
        db.prepare(
          "UPDATE mail SET attempts=attempts+1,status=?,next_attempt=? WHERE id=?",
        ).run(
          mail.attempts >= 7 ? "failed" : "pending",
          Date.now() + Math.min(3600000, 30000 * 2 ** mail.attempts),
          mail.id,
        );
      }
    }
  } finally {
    busy = false;
  }
}
