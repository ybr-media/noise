import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFailureDetails } from "../lib/dispatch";

test("parses failed Actions job diagnostics without inventing an exit code", () => {
  const failure = parseFailureDetails([{
    name: "render",
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:03:10Z",
    runner_name: "ubuntu-22.04",
    conclusion: "failure",
    steps: [
      { name: "setup", conclusion: "success" },
      { name: "render", conclusion: "failure" },
    ],
  }]);
  assert.deepEqual(failure, { step: "render", exitCode: null, durationSeconds: 190, runner: "ubuntu-22.04" });
});
