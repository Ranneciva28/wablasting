import { test } from "node:test";
import assert from "node:assert/strict";
import { originValues, validOrigins } from "../src/origin.js";
import { server } from "../support/test-server.js";
const expected = "http://127.0.0.1:3000";
test("proxy duplicates require every Origin value to match exactly", () => {
  const copies = originValues([
    "Host",
    "example.test",
    "origin",
    expected,
    "Origin",
    expected,
  ]);
  assert.deepEqual(copies, [expected, expected]);
  assert.equal(validOrigins(copies, expected), true);
  assert.deepEqual(
    originValues(["Origin", `${expected}, ${expected}`]),
    copies,
  );
  for (const value of [
    `${expected}, https://evil.example`,
    `https://evil.example, ${expected}`,
    "null",
    "",
    expected + "/",
    "http://127.0.0.1:3000.evil.example",
    expected + " https://evil.example",
  ])
    assert.equal(
      validOrigins(originValues(["Origin", value]), expected),
      false,
      value,
    );
  assert.equal(validOrigins([], expected), true); // Existing custom-header CSRF requirement still applies.
});
test("duplicated same-origin POST reaches setup while mixed-origin requests remain blocked", async () => {
  const s = await server();
  try {
    const body = {};
    const same = await s.request("/api/setup/complete", {
      body,
      origin: `${expected}, ${expected}`,
    });
    assert.equal(same.status, 403);
    assert.equal(same.data.error, "Tautan setup tidak valid");
    assert.equal(same.originCopies, "2");
    for (const origin of [
      `${expected}, https://evil.example`,
      `https://evil.example, ${expected}`,
    ]) {
      const result = await s.request("/api/setup/complete", { body, origin });
      assert.equal(result.status, 403);
      assert.equal(result.data.error, "Invalid request origin");
    }
    assert.equal(
      (
        await s.request("/api/setup/complete", {
          body,
          origin: `${expected}, ${expected}`,
          csrf: false,
        })
      ).data.error,
      "Invalid request origin",
    );
  } finally {
    await s.close();
  }
});
