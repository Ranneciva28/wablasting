import { db } from "./store.js";
import { active, workspace } from "./saas.js";
import { personalize } from "./validation.js";
export function recover() {
  db.exec(
    "UPDATE deliveries SET status='unknown',error='Server restart saat pengiriman; periksa WhatsApp sebelum mengirim ulang' WHERE status='sending'; UPDATE campaigns SET status='paused' WHERE status='running';",
  );
}
export function createWorker(transport) {
  let busy = false,
    stopped = false;
  return {
    stop() {
      stopped = true;
    },
    get busy() {
      return busy;
    },
    async tick() {
      if (busy || stopped) return;
      busy = true;
      try {
        const campaigns = db
          .prepare(
            "SELECT * FROM campaigns WHERE status IN ('queued','running') AND COALESCE(scheduled,0)<=? ORDER BY created",
          )
          .all(Date.now());
        // Process workspaces concurrently so one slow socket does not stall other tenants.
        const outcomes = await Promise.allSettled(
          campaigns.map(async (c) => {
            if (stopped) return;
            if (!active(workspace(c.user))) {
              db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(
                c.id,
              );
              return;
            }
            if (transport.status(c.user).state !== "connected") return;
            const d = db
              .prepare(
                "SELECT * FROM deliveries WHERE campaign=? AND status='pending' ORDER BY rowid LIMIT 1",
              )
              .get(c.id);
            if (!d) {
              db.prepare(
                "UPDATE campaigns SET status='completed' WHERE id=?",
              ).run(c.id);
              return;
            }
            db.prepare("UPDATE campaigns SET status='running' WHERE id=?").run(
              c.id,
            );
            const contact = db
              .prepare(
                "SELECT id FROM contacts WHERE user=? AND phone=? AND optin=1",
              )
              .get(c.user, d.phone);
            const suppressed = db
              .prepare(
                "SELECT phone FROM suppressions WHERE workspace=? AND phone=?",
              )
              .get(c.user, d.phone);
            if (!contact || suppressed) {
              db.prepare(
                "UPDATE deliveries SET status='skipped',error='Kontak tidak aktif atau opt-out' WHERE id=?",
              ).run(d.id);
              return;
            }
            db.prepare("UPDATE deliveries SET status='sending' WHERE id=?").run(
              d.id,
            );
            let timer;
            try {
              const message = personalize(c.message, d.name);
              const result = await Promise.race([
                transport.send(c.user, d.phone, message),
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => reject(Error("Send timeout")),
                    45000,
                  );
                }),
              ]);
              db.prepare(
                "UPDATE deliveries SET status='sent',waid=? WHERE id=?",
              ).run(result?.key?.id || null, d.id);
            } catch {
              db.prepare(
                "UPDATE deliveries SET status='unknown',error='Hasil pengiriman tidak pasti; periksa WhatsApp. Tidak diulang otomatis.' WHERE id=?",
              ).run(d.id);
              db.prepare(
                "UPDATE campaigns SET status='paused' WHERE id=? AND status='running'",
              ).run(c.id);
            } finally {
              clearTimeout(timer);
            }
          }),
        );
        for (const result of outcomes)
          if (result.status === "rejected")
            console.error(
              JSON.stringify({
                event: "worker.delivery_error",
                type: result.reason?.name || "Error",
              }),
            );
      } finally {
        busy = false;
      }
    },
  };
}
