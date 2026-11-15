import { JSDOM, VirtualConsole, CookieJar } from "jsdom";
import { test } from "node:test";
import { server } from "../support/test-server.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
test("customer dashboard interactions and configured pricing render in DOM", async () => {
  const s = await server();
  const errors = [];
  let dom;
  const wait = async (fn) => {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("UI wait timed out");
  };
  try {
    const jar = new CookieJar();
    const user = await s.register("dom@example.com");
    jar.setCookieSync(user.cookie + "; Path=/", s.base);
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => errors.push(e.message));
    dom = await JSDOM.fromURL(s.base + "/app", {
      resources: "usable",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      cookieJar: jar,
      virtualConsole: vc,
      beforeParse(window) {
        window.crypto.randomUUID = randomUUID;
        window.fetch = async (input, init = {}) => {
          const url = new URL(input, s.base).href;
          const cookie = jar.getCookieStringSync(url);
          const result = await fetch(url, {
            ...init,
            headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
          });
          const set = result.headers.get("set-cookie");
          if (set) jar.setCookieSync(set, url);
          return result;
        };
      },
    });
    const $ = (sel) => dom.window.document.querySelector(sel);
    const hash = async (value) => {
      dom.window.location.hash = value;
      await new Promise((r) => setTimeout(r, 100));
    };
    await wait(() => $("#stats").children.length === 3);
    assert.equal($("#verify-banner").hidden, true);
    await hash("contacts");
    await wait(() => !$("[data-panel=contacts]").hidden);
    for (const [k, v] of Object.entries({
      name: "Rani",
      phone: "08123456789",
      source: "Form pelanggan",
    }))
      $(`#contact-form [name=${k}]`).value = v;
    $("#contact-form [name=optin]").checked = true;
    $("#contact-form").requestSubmit($("#contact-form button"));
    await wait(() => $("#notice").textContent === "Kontak disimpan.");
    assert.match($("#contact-list").textContent, /Rani/);
    $("#select-page").click();
    await wait(() => $("#selected-count").textContent.startsWith("1 kontak"));
    await hash("campaigns");
    await wait(() => $("#campaign-hint").textContent.startsWith("1 kontak"));
    await hash("templates");
    $("#template-form [name=name]").value = "Greeting";
    $("#template-form [name=message]").value = "Halo {{nama}}";
    $("#template-form").requestSubmit($("#template-form button"));
    await wait(() => $("#notice").textContent === "Template disimpan.");
    assert.match($("#template-list").textContent, /Greeting/);
    await hash("billing");
    await wait(() => $("#billing-plans").children.length === 3);
    assert.deepEqual(errors, []);
    dom.window.close();
    dom = null;
    const landing = await JSDOM.fromURL(s.base, {
      resources: "usable",
      runScripts: "dangerously",
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = (input, init) => fetch(new URL(input, s.base), init);
      },
    });
    await wait(
      () =>
        landing.window.document.querySelectorAll("#pricing-grid .plan")
          .length === 3,
    );
    landing.window.close();
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await s.close();
  }
});
