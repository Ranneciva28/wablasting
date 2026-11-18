import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { server } from "../support/test-server.js";

test("minimal production boot uses private one-time browser setup without requiring SMTP", async () => {
  const s = await server({
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    APP_URL: "https://whapi.avicennarabama.com",
    ADMIN_EMAILS: "",
  });
  try {
    assert.equal((await s.request("/api/setup/status")).data.required, true);
    assert.equal((await s.request("/api/public")).data.publicSignup, false);
    assert.equal(
      (
        await s.request("/api/auth/register", {
          body: {
            email: "customer@example.com",
            password: "long-password-123",
            acceptTerms: true,
          },
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await s.request("/api/setup/complete", {
          body: { email: "owner@example.com", password: "long-password-123" },
          headers: { "X-Setup-Key": "00".repeat(32) },
        })
      ).status,
      403,
    );
    const token = (await readFile(join(s.dir, "setup-access"), "utf8")).trim();
    const body = { email: "owner@example.com", password: "long-password-123" };
    const attempts = await Promise.all([
      s.request("/api/setup/complete", {
        body,
        headers: { "X-Setup-Key": token },
      }),
      s.request("/api/setup/complete", {
        body,
        headers: { "X-Setup-Key": token },
      }),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 403]);
    const owner = attempts.find((r) => r.status === 201);
    const me = await s.request("/api/me", { cookie: owner.cookie });
    assert.equal(me.data.superAdmin, true);
    assert.equal(me.data.verified, 1);
    assert.equal((await s.request("/api/setup/status")).data.required, false);
    assert.equal(
      (await s.request("/api/admin/settings", { cookie: owner.cookie })).status,
      200,
    );
    assert.equal(
      (
        await s.request("/api/billing/invoices", {
          cookie: owner.cookie,
          body: { plan: "starter" },
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await s.request("/api/setup/complete", {
          body,
          headers: { "X-Setup-Key": token },
        })
      ).status,
      403,
    );
  } finally {
    await s.close();
  }
});

test("panel settings enforce admin and password, encrypt SMTP, persist and update prices immediately", async () => {
  const s = await server();
  try {
    const owner = await s.register("owner@example.com");
    const admin = await s.register("super@example.com");
    assert.equal(
      (await s.request("/api/admin/settings", { cookie: owner.cookie })).status,
      403,
    );
    assert.equal(
      (await s.request("/api/admin/settings", { cookie: admin.cookie })).status,
      200,
    );
    assert.equal(
      (
        await s.request("/api/admin/settings", {
          method: "PUT",
          cookie: admin.cookie,
          body: {
            currentPassword: "wrong-password-123",
            brand: "Should not save",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.request("/api/admin/settings", {
          method: "PUT",
          cookie: admin.cookie,
          body: {
            currentPassword: "long-password-123",
            brand: "Sena WhatsApp Blast",
            businessName: "Sena",
            supportEmail: "support@example.com",
            paymentInstructions: "BRI 123 Sena",
            mailFrom: "sender@example.com",
            publicSignup: true,
            prices: { starter: 120000 },
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await s.request("/api/public")).data.plans.starter.price,
      120000,
    );
    assert.equal(
      (await s.request("/api/public")).data.brand,
      "Sena WhatsApp Blast",
    );
    const password = "smtp-$ecret!";
    const smtp = {
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      username: "sender@example.com",
      password,
      secure: false,
    };
    const save = await s.request("/api/admin/settings", {
      method: "PUT",
      cookie: admin.cookie,
      body: { currentPassword: "long-password-123", smtp },
    });
    assert.equal(save.status, 200);
    assert.equal(save.data.smtp.hasPassword, true);
    assert.equal(JSON.stringify(save.data).includes(password), false);
    assert.equal(JSON.stringify(save.data).includes("smtp://"), false);
    assert.equal(
      s.db
        .prepare("SELECT payload FROM platform_settings")
        .get()
        .payload.includes(password),
      false,
    );
    const preserved = await s.request("/api/admin/settings", {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        currentPassword: "long-password-123",
        smtp: { ...smtp, password: "" },
      },
    });
    assert.equal(preserved.status, 200);
    assert.equal(preserved.data.smtp.hasPassword, true);
    assert.equal(
      (
        await s.request("/api/admin/settings", {
          method: "PUT",
          cookie: admin.cookie,
          body: {
            currentPassword: "long-password-123",
            smtp: { ...smtp, host: "another.example.com", password: "" },
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await s.request("/api/admin/settings", {
          method: "PUT",
          cookie: admin.cookie,
          body: {
            currentPassword: "long-password-123",
            prices: { starter: -1 },
          },
        })
      ).status,
      400,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const {settingsView}=await import('./src/settings.js');console.log(JSON.stringify(settingsView()));const {db}=await import('./src/store.js');db.close();",
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATA_DIR: s.dir,
          SESSION_ENCRYPTION_KEY: "ab".repeat(32),
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).brand, "Sena WhatsApp Blast");
    assert.equal(JSON.parse(result.stdout).smtp.hasPassword, true);
  } finally {
    await s.close();
  }
});

test("private setup link still requires the password when selecting an existing account", async () => {
  const s = await server();
  try {
    const user = await s.register("existing@example.com", false);
    const token = (await readFile(join(s.dir, "setup-access"), "utf8")).trim();
    assert.equal(
      (
        await s.request("/api/setup/complete", {
          headers: { "X-Setup-Key": token },
          body: { email: user.email, password: "different-password-123" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await s.request("/api/me", { cookie: user.cookie })).data.superAdmin,
      false,
    );
    const result = await s.request("/api/setup/complete", {
      headers: { "X-Setup-Key": token },
      body: { email: user.email, password: "long-password-123" },
    });
    assert.equal(result.status, 201);
    assert.equal(
      (await s.request("/api/me", { cookie: result.cookie })).data.superAdmin,
      true,
    );
    assert.equal(
      (
        await s.request("/api/admin/settings/test-email", {
          cookie: result.cookie,
          body: { currentPassword: "long-password-123" },
        })
      ).status,
      503,
    );
  } finally {
    await s.close();
  }
});
