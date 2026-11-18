import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
export async function server(extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), "wablasting-api-"));
  const key = "ab".repeat(32);
  const child = spawn(process.execPath, ["src/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      COOKIE_SECURE: "false",
      PUBLIC_SIGNUP: "true",
      PORT: "0",
      DATA_DIR: dir,
      SESSION_ENCRYPTION_KEY: key,
      ADMIN_EMAILS: "super@example.com",
      SMTP_URL: "",
      APP_URL: "http://127.0.0.1:3000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    timer;
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      output += d;
      const m = output.match(/ready on (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on("data", (d) => {
      output += d;
    });
    child.once("exit", () => reject(Error(output)));
  });
  let port;
  try {
    port = await Promise.race([
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(output)), 20000);
      }),
    ]);
  } catch (e) {
    child.kill();
    await rm(dir, { recursive: true, force: true });
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const db = new DatabaseSync(join(dir, "app.sqlite"));
  const base = `http://127.0.0.1:${port}`;
  async function request(
    path,
    { body, cookie, workspace, method, csrf = true, origin, headers = {} } = {},
  ) {
    const response = await fetch(base + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(csrf ? { "X-Requested-With": "wablasting" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      originCopies: response.headers.get("x-validated-origin-count"),
    };
  }
  function mailToken(email, kind) {
    const mails = db.prepare("SELECT * FROM mail ORDER BY rowid DESC").all();
    for (const mail of mails) {
      if (!mail.payload) continue;
      const b = Buffer.from(mail.payload, "base64"),
        c = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(key, "hex"),
          b.subarray(0, 12),
        );
      c.setAuthTag(b.subarray(12, 28));
      const payload = JSON.parse(
        Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(),
      );
      const token = payload.text.match(
        new RegExp(`#${kind}=([a-f0-9]{64})`),
      )?.[1];
      if (payload.to === email && token) return token;
    }
    throw Error("Mail token not found " + email + " " + kind);
  }
  async function register(email, verified = true) {
    const result = await request("/api/auth/register", {
      body: {
        email,
        password: "long-password-123",
        company: email.split("@")[0],
        acceptTerms: true,
      },
    });
    if (result.status !== 201) throw Error(JSON.stringify(result));
    const me = await request("/api/me", { cookie: result.cookie });
    if (verified) {
      const v = await request("/api/auth/verify", {
        body: { token: mailToken(email, "verify") },
      });
      if (v.status !== 200) throw Error(JSON.stringify(v));
    }
    return { ...me.data, cookie: result.cookie };
  }
  return {
    base,
    db,
    dir,
    child,
    request,
    mailToken,
    register,
    async close() {
      db.close();
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
      await rm(dir, { recursive: true, force: true });
    },
  };
}
