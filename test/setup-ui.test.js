import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("UI timeout");
};
async function page(postBody, status, completed = false) {
  const html = await readFile("public/setup.html", "utf8"),
    script = await readFile("public/setup.js", "utf8");
  const dom = new JSDOM(html, {
    url: "https://example.test/setup#key=" + "ab".repeat(32),
    runScripts: "outside-only",
  });
  let posts = 0;
  dom.window.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      posts++;
      assert.equal(options.headers["X-Setup-Key"], "ab".repeat(32));
      return new Response(postBody, { status });
    }
    return new Response(
      JSON.stringify({ required: !completed || posts === 0 }),
      { status: 200 },
    );
  };
  dom.window.eval(script);
  await new Promise((r) => setTimeout(r, 0));
  const form = dom.window.document.querySelector("#setup-form");
  form.elements.email.value = "owner@example.com";
  form.elements.password.value = "long-password-123";
  form.elements.confirm.value = "long-password-123";
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  return dom;
}
test("empty and HTML proxy responses show HTTP status instead of a JSON exception and allow retry", async () => {
  for (const body of ["", "<html>Unavailable</html>"]) {
    const dom = await page(body, 503);
    try {
      await wait(() =>
        dom.window.document
          .querySelector("#setup-notice")
          .textContent.includes("HTTP 503"),
      );
      assert.equal(dom.window.document.querySelector("button").disabled, false);
      assert.equal(
        dom.window.document
          .querySelector("#setup-notice")
          .textContent.includes("Unexpected end"),
        false,
      );
      assert.equal(dom.window.location.hash, "");
    } finally {
      dom.window.close();
    }
  }
});
test("lost response after setup completion offers login instead of registering again", async () => {
  const dom = await page("", 503, true);
  try {
    await wait(() => dom.window.document.querySelector("#setup-form").hidden);
    assert.equal(
      dom.window.document.querySelector("#setup-notice a").getAttribute("href"),
      "/app",
    );
    assert.match(
      dom.window.document.querySelector("#setup-notice").textContent,
      /Setup admin sudah selesai/,
    );
  } finally {
    dom.window.close();
  }
});
