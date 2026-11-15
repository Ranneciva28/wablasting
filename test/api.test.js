import { test } from "node:test";
import assert from "node:assert/strict";
import { server } from "../support/test-server.js";
test("tenant isolation, CSV atomicity, opt-out and request origin protection", async () => {
  const s = await server();
  try {
    assert.equal((await s.request("/api/me")).status, 401);
    assert.equal(
      (
        await s.request("/api/auth/register", {
          body: { email: "a@example.com", password: "long-password-123" },
          csrf: false,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.request("/api/auth/register", {
          body: { email: "a@example.com", password: "long-password-123" },
          origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const a = await s.register("a@example.com"),
      b = await s.register("b@example.com");
    assert.equal(
      (await s.request("/api/workspace", { cookie: b.cookie, workspace: a.id }))
        .status,
      403,
    );
    assert.equal(
      (
        await s.request("/api/contacts", {
          cookie: a.cookie,
          body: {
            name: "Test",
            phone: "08123456789",
            optin: true,
            source: "Form web",
          },
        })
      ).status,
      201,
    );
    assert.equal(
      (await s.request("/api/contacts", { cookie: b.cookie })).data.length,
      0,
    );
    const contact = (await s.request("/api/contacts", { cookie: a.cookie }))
      .data[0];
    assert.equal(contact.phone, "628123456789");
    const failed = await s.request("/api/contacts/import", {
      cookie: a.cookie,
      body: {
        csv: "name,phone\nValid,628111111111\nInvalid,abc",
        source: "Test",
        optin: true,
      },
    });
    assert.equal(failed.status, 400);
    assert.equal(
      (await s.request("/api/contacts", { cookie: a.cookie })).data.length,
      1,
    );
    assert.equal(
      (
        await s.request("/api/contacts/import", {
          cookie: a.cookie,
          body: {
            csv: 'name,phone\n"A, B",628111111111',
            source: "Test",
            optin: true,
          },
        })
      ).status,
      201,
    );
    await s.request("/api/suppressions", {
      cookie: a.cookie,
      body: { phone: contact.phone },
    });
    assert.equal(
      (
        await s.request("/api/contacts", {
          cookie: a.cookie,
          body: {
            name: "Again",
            phone: contact.phone,
            optin: true,
            source: "Old",
          },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.request("/api/campaigns", {
          cookie: a.cookie,
          headers: { "Idempotency-Key": "test-key-1234" },
          body: { name: "Test", message: "Hello", contacts: [contact.id] },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.request("/api/templates", {
          cookie: a.cookie,
          body: { name: "Test", message: "Hello {{nama}}" },
        })
      ).status,
      201,
    );
    assert.equal(
      (await s.request("/api/templates", { cookie: b.cookie })).data.length,
      0,
    );
    const before = (await s.request("/api/contacts", { cookie: a.cookie })).data
      .length;
    assert.equal(
      (
        await s.request("/api/contacts/" + contact.id, {
          cookie: b.cookie,
          method: "DELETE",
        })
      ).status,
      404,
    );
    assert.equal(
      (await s.request("/api/contacts", { cookie: a.cookie })).data.length,
      before,
    );
    await s.request("/api/logout", { cookie: a.cookie, body: {} });
    assert.equal(
      (await s.request("/api/me", { cookie: a.cookie })).status,
      401,
    );
  } finally {
    await s.close();
  }
});
test("verified platform admin alone settles invoices, idempotent approval and team role boundaries", async () => {
  const s = await server();
  try {
    const owner = await s.register("owner@example.com"),
      operator = await s.register("operator@example.com"),
      superAdmin = await s.register("super@example.com", false);
    assert.equal(
      (await s.request("/api/admin/overview", { cookie: owner.cookie })).status,
      403,
    );
    assert.equal(
      (await s.request("/api/admin/overview", { cookie: superAdmin.cookie }))
        .status,
      403,
    );
    await s.request("/api/auth/verify", {
      body: { token: s.mailToken(superAdmin.email, "verify") },
    });
    const invoice = await s.request("/api/billing/invoices", {
      cookie: owner.cookie,
      body: { plan: "growth", amount: 1 },
    });
    assert.equal(invoice.status, 201);
    assert.equal(invoice.data.amount, 249000);
    const same = await s.request("/api/billing/invoices", {
      cookie: owner.cookie,
      body: { plan: "growth" },
    });
    assert.equal(same.data.id, invoice.data.id);
    assert.equal(
      (
        await s.request("/api/admin/invoices/" + invoice.data.id + "/approve", {
          cookie: owner.cookie,
          body: { reference: "fake" },
        })
      ).status,
      403,
    );
    await s.request("/api/billing/invoices/" + invoice.data.id + "/confirm", {
      cookie: owner.cookie,
      body: { reference: "transfer ref" },
    });
    assert.equal(
      (await s.request("/api/workspace", { cookie: owner.cookie })).data.plan,
      "trial",
    );
    const approved = await s.request(
      "/api/admin/invoices/" + invoice.data.id + "/approve",
      { cookie: superAdmin.cookie, body: { reference: "Bank verified 123" } },
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.data.status, "paid");
    const active = (await s.request("/api/workspace", { cookie: owner.cookie }))
      .data;
    assert.equal(active.plan, "growth");
    await s.request("/api/admin/invoices/" + invoice.data.id + "/approve", {
      cookie: superAdmin.cookie,
      body: { reference: "duplicate" },
    });
    assert.equal(
      (await s.request("/api/workspace", { cookie: owner.cookie })).data
        .period_end,
      active.period_end,
    );
    assert.equal(
      (
        await s.request("/api/billing/invoices", {
          cookie: owner.cookie,
          body: { plan: "business" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.request("/api/team/invite", {
          cookie: owner.cookie,
          body: { email: operator.email, role: "operator" },
        })
      ).status,
      201,
    );
    const invite = s.mailToken(operator.email, "invite");
    assert.equal(
      (
        await s.request("/api/invites/accept", {
          cookie: superAdmin.cookie,
          body: { token: invite },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await s.request("/api/invites/accept", {
          cookie: operator.cookie,
          body: { token: invite },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await s.request("/api/invites/accept", {
          cookie: operator.cookie,
          body: { token: invite },
        })
      ).status,
      400,
    );
    for (const [path, body] of [
      ["/api/team/invite", { email: "new@example.com", role: "admin" }],
      ["/api/whatsapp/connect", {}],
      ["/api/billing/invoices", { plan: "starter" }],
    ])
      assert.equal(
        (
          await s.request(path, {
            cookie: operator.cookie,
            workspace: owner.id,
            body,
          })
        ).status,
        403,
      );
    await s.request("/api/team/" + operator.id, {
      cookie: owner.cookie,
      method: "DELETE",
    });
    assert.equal(
      (
        await s.request("/api/workspace", {
          cookie: operator.cookie,
          workspace: owner.id,
        })
      ).status,
      403,
    );
    await s.request("/api/admin/workspaces/" + owner.id + "/status", {
      cookie: superAdmin.cookie,
      body: { status: "suspended" },
    });
    assert.equal(
      (
        await s.request("/api/contacts", {
          cookie: owner.cookie,
          body: {
            name: "Test",
            phone: "628111111111",
            source: "test",
            optin: true,
          },
        })
      ).status,
      402,
    );
  } finally {
    await s.close();
  }
});
test("one-time email verification and password reset invalidate all existing sessions", async () => {
  const s = await server();
  try {
    const user = await s.register("reset@example.com", false);
    assert.equal(
      (
        await s.request("/api/whatsapp/connect", {
          cookie: user.cookie,
          body: {},
        })
      ).status,
      403,
    );
    const token = s.mailToken(user.email, "verify");
    assert.equal(
      (await s.request("/api/auth/verify", { body: { token } })).status,
      200,
    );
    assert.equal(
      (await s.request("/api/auth/verify", { body: { token } })).status,
      400,
    );
    const unknown = await s.request("/api/auth/forgot", {
      body: { email: "unknown@example.com" },
    });
    const known = await s.request("/api/auth/forgot", {
      body: { email: user.email },
    });
    assert.deepEqual(unknown.data, known.data);
    const reset = s.mailToken(user.email, "reset");
    assert.equal(
      (
        await s.request("/api/auth/reset", {
          body: { token: reset, password: "new-password-12345" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await s.request("/api/me", { cookie: user.cookie })).status,
      401,
    );
    assert.equal(
      (
        await s.request("/api/auth/reset", {
          body: { token: reset, password: "new-password-12345" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await s.request("/api/auth/login", {
          body: { email: user.email, password: "long-password-123" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await s.request("/api/auth/login", {
          body: { email: user.email, password: "new-password-12345" },
        })
      ).status,
      200,
    );
  } finally {
    await s.close();
  }
});

test("campaign idempotency rejects changed payload, contact pagination, and data deletion preserves usage", async () => {
  const s = await server();
  try {
    const u = await s.register("idempotent@example.com");
    const body = {
      name: "Campaign",
      message: "Hello",
      contacts: ["c"],
      scheduled: null,
    };
    const { createHash } = await import("node:crypto");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    s.db
      .prepare(
        "INSERT INTO campaigns(id,user,name,message,status,created,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "prior",
        u.id,
        "Campaign",
        "Hello",
        "completed",
        Date.now(),
        "unique-key-123",
        fingerprint,
      );
    const replay = await s.request("/api/campaigns", {
      cookie: u.cookie,
      headers: { "Idempotency-Key": "unique-key-123" },
      body,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.id, "prior");
    assert.equal(replay.data.replayed, true);
    assert.equal(
      (
        await s.request("/api/campaigns", {
          cookie: u.cookie,
          headers: { "Idempotency-Key": "unique-key-123" },
          body: { ...body, message: "Different" },
        })
      ).status,
      409,
    );
    const w = s.db.prepare("SELECT * FROM workspaces WHERE id=?").get(u.id);
    s.db
      .prepare("INSERT INTO usage VALUES(?,?,?)")
      .run(u.id, w.period_start, 25);
    const insert = s.db.prepare("INSERT INTO contacts VALUES(?,?,?,?,1)");
    for (let i = 0; i < 100; i++)
      insert.run("c" + i, u.id, "Contact " + i, "628" + String(111111111 + i));
    assert.equal(
      (await s.request("/api/contacts?offset=0", { cookie: u.cookie })).data
        .length,
      100,
    );
    assert.equal(
      (await s.request("/api/contacts?offset=100", { cookie: u.cookie })).data
        .length,
      0,
    );
    assert.equal(
      (
        await s.request("/api/contacts", {
          cookie: u.cookie,
          body: {
            name: "Overflow",
            phone: "628999999999",
            source: "form",
            optin: true,
          },
        })
      ).status,
      402,
    );
    assert.equal(
      (
        await s.request("/api/workspace/data", {
          cookie: u.cookie,
          method: "DELETE",
          body: { password: "wrong-password-123", confirm: "DELETE" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.request("/api/workspace/data", {
          cookie: u.cookie,
          method: "DELETE",
          body: { password: "long-password-123", confirm: "DELETE" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await s.request("/api/contacts", { cookie: u.cookie })).data.length,
      0,
    );
    assert.equal(
      (await s.request("/api/workspace", { cookie: u.cookie })).data.used,
      25,
    );
  } finally {
    await s.close();
  }
});
