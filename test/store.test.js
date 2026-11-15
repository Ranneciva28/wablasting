import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("auth encryption rejects tampering and uses unique nonces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-store-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_ENCRYPTION_KEY = "ab".repeat(32);
  const { encrypt, decrypt, db } = await import("../src/store.js");
  try {
    const a = encrypt("sensitive session"),
      b = encrypt("sensitive session");
    assert.notEqual(a, b);
    assert.equal(decrypt(a), "sensitive session");
    assert.equal(a.includes("sensitive"), false);
    const corrupt = Buffer.from(a, "base64");
    corrupt[30] ^= 1;
    assert.throws(() => decrypt(corrupt.toString("base64")));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
