import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedEmail } from "../lib/allowlist";

test("allowlist accepts exact addresses and whole domains", () => {
  const allowlist = "@ybellrecords.com,austin@marlo.today";
  assert.equal(isAllowedEmail("Austin@YBELLRECORDS.com", allowlist), true);
  assert.equal(isAllowedEmail("austin@marlo.today", allowlist), true);
  assert.equal(isAllowedEmail("other@marlo.today", allowlist), false);
  assert.equal(isAllowedEmail("person@ybellrecords.com.evil.test", allowlist), false);
});

test("empty and malformed addresses are rejected", () => {
  assert.equal(isAllowedEmail("", "@example.com"), false);
  assert.equal(isAllowedEmail("example.com", "@example.com"), false);
});
