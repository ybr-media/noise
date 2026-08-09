import assert from "node:assert/strict";
import { test } from "node:test";
import { lintNames } from "../lib/name-lint";
import { loadPilotVariants } from "../lib/config";
import { localStubProvider } from "../lib/naming";

test("name lint reports hard failures with row and title", () => {
  const result = lintNames(["Calm", "Calm", "FOR SLEEP FOCUS CALM", "bad @handle", " spaced "]);
  assert.equal(result.hardFailures.length, 3);
  assert.match(result.hardFailures[0].message, /row 1/);
  assert.equal(result.hardFailures[0].title, "Calm");
  assert.ok(result.warnings.some((message) => message.message.includes("keyword")));
});

test("clean names have no lint messages", () => {
  assert.deepEqual(lintNames(["Pink Drift", "Brown Still"]).messages, []);
});

test("pilot stub names are distinct and pass hard lint rules", () => {
  const titles = loadPilotVariants().map((variant) => localStubProvider.generate(variant).title);
  assert.equal(new Set(titles).size, 8);
  assert.equal(lintNames(titles).hardFailures.length, 0);
});
