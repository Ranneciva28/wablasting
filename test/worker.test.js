import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("quota reservation, queue recovery, suppression, plan expiry and ambiguous delivery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wablasting-worker-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_ENCRYPTION_KEY = "ab".repeat(32);
  const { db, transaction } = await import("../src/store.js");
  const { createWorker, recover } = await import("../src/worker.js");
  const { createWorkspace, workspace, reserve, usage } =
    await import("../src/saas.js");
  try {
    db.prepare(
      "INSERT INTO users(id,email,password,verified) VALUES(?,?,?,1)",
    ).run("tenant", "worker@example.com", "unused");
    createWorkspace("tenant", "Worker");
    const w = workspace("tenant");
    transaction(() => reserve(w, 49));
    assert.equal(usage(w), 49);
    assert.throws(() => transaction(() => reserve(w, 2)));
    assert.equal(usage(w), 49);
    const make = (id, phone, status = "pending") => {
      db.prepare(
        "INSERT INTO contacts VALUES(?,?,?,?,1) ON CONFLICT DO NOTHING",
      ).run("contact-" + id, "tenant", id, phone);
      db.prepare(
        "INSERT INTO campaigns(id,user,name,message,status,created) VALUES(?,?,?,?,?,?)",
      ).run(id, "tenant", id, "Halo {{nama}}", "queued", Date.now());
      db.prepare(
        "INSERT INTO deliveries(id,campaign,phone,name,status) VALUES(?,?,?,?,?)",
      ).run("d-" + id, id, phone, "Rani", status);
    };
    make("uncertain", "628111111111", "sending");
    db.prepare(
      "UPDATE campaigns SET status='running' WHERE id='uncertain'",
    ).run();
    make("scheduled", "628111111112");
    db.prepare("UPDATE campaigns SET scheduled=? WHERE id='scheduled'").run(
      Date.now() + 86400000,
    );
    recover();
    assert.equal(
      db.prepare("SELECT status FROM deliveries WHERE id='d-uncertain'").get()
        .status,
      "unknown",
    );
    assert.equal(
      db.prepare("SELECT status FROM campaigns WHERE id='uncertain'").get()
        .status,
      "paused",
    );
    assert.equal(
      db.prepare("SELECT status FROM campaigns WHERE id='scheduled'").get()
        .status,
      "queued",
    );
    make("blocked", "628111111113");
    db.prepare("INSERT INTO suppressions VALUES(?,?,?)").run(
      "tenant",
      "628111111113",
      Date.now(),
    );
    make("success", "628111111114");
    make("ambiguous", "628111111115");
    let calls = [];
    const worker = createWorker({
      status: () => ({ state: "connected" }),
      send: async (user, phone, message) => {
        calls.push({ user, phone, message });
        if (phone === "628111111115") throw Error("transport lost");
        return { key: { id: "wa-123" } };
      },
    });
    await worker.tick();
    assert.equal(
      db.prepare("SELECT status FROM deliveries WHERE id='d-blocked'").get()
        .status,
      "skipped",
    );
    assert.equal(
      db.prepare("SELECT status FROM deliveries WHERE id='d-success'").get()
        .status,
      "sent",
    );
    assert.equal(
      db.prepare("SELECT status FROM deliveries WHERE id='d-ambiguous'").get()
        .status,
      "unknown",
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].message, "Halo Rani");
    await worker.tick();
    assert.equal(calls.length, 2);
    make("expired", "628111111116");
    db.prepare("UPDATE workspaces SET period_end=? WHERE id=?").run(
      Date.now() - 1,
      "tenant",
    );
    await worker.tick();
    assert.equal(calls.length, 2);
    assert.equal(
      db.prepare("SELECT status FROM campaigns WHERE id='expired'").get()
        .status,
      "paused",
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
