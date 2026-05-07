import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compareEvalRuns } from "../../src/index.js";

async function createRunRoot(status: "completed" | "failed"): Promise<string> {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "eval-scenario-"));
  await mkdir(path.join(runRoot, "phases", "design"), { recursive: true });
  await mkdir(path.join(runRoot, "trajectory", "design"), { recursive: true });
  await writeFile(
    path.join(runRoot, "state.json"),
    JSON.stringify({
      estimated_dollars: status === "completed" ? 0.1 : 0.2,
      status,
    }),
    "utf8",
  );
  await writeFile(
    path.join(runRoot, "phases", "design", "exit_code.json"),
    JSON.stringify({
      duration_ms: status === "completed" ? 10 : 20,
      status,
    }),
    "utf8",
  );
  await writeFile(
    path.join(runRoot, "trajectory", "design", "summary.json"),
    JSON.stringify({
      event_count: 1,
      status: "captured",
      tool_call_count: 1,
      total_tokens: status === "completed" ? 100 : 200,
    }),
    "utf8",
  );
  return runRoot;
}

describe("eval scenario compare", () => {
  it("marks lower head success as regression", async () => {
    const baseRunRoot = await createRunRoot("completed");
    const headRunRoot = await createRunRoot("failed");

    const result = await compareEvalRuns({ baseRunRoot, headRunRoot });

    expect(result.verdict).toBe("regression");
    expect(result.base.task_success_rate).toBe(1);
    expect(result.head.task_success_rate).toBe(0);
  });
});
