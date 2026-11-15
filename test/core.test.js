import { test } from "node:test";
import assert from "node:assert/strict";
import { phone, personalize } from "../src/validation.js";
test("normalizes Indonesian and international numbers", () => {
  assert.equal(phone("0812 3456 7890"), "6281234567890");
  assert.equal(phone("+44 7911 123456"), "447911123456");
  for (const n of ["abc", "123", "62<script>"]) assert.throws(() => phone(n));
});
test("personalization treats dollar replacement tokens literally", () => {
  assert.equal(personalize("Halo {{nama}} / {{nama}}", "$&"), "Halo $& / $&");
});
