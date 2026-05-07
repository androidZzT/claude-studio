import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getRunStorePaths, ingestRunTrajectory } from "../../src/index.js";

describe("run trajectory ingest", () => {
  it("converts captured phase common-events into an EvalLog", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "ingest-run-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(path.join(paths.trajectoryDir, "01-design"), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.trajectoryDir, "01-design", "common-events.jsonl"),
      [
        JSON.stringify({
          source: "codex",
          session_id: "s1",
          event_id: "e1",
          timestamp: "2026-05-03T10:00:00.000Z",
          kind: "user_input",
          text: "prompt",
          raw: {},
        }),
        JSON.stringify({
          source: "codex",
          session_id: "s1",
          event_id: "e2",
          timestamp: "2026-05-03T10:00:01.000Z",
          kind: "tool_call",
          tool: { name: "exec_command", input: {} },
          raw: {},
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await ingestRunTrajectory({
      harnessRepoPath: repo,
      scenarioId: "scenario-1",
      threadId: "thread-1",
    });

    expect(result).toMatchObject({
      eventCount: 2,
      phaseCount: 1,
      runRoot: paths.rootDir,
    });
    await expect(readFile(result.outPath, "utf8")).resolves.toContain(
      '"scenario_id": "scenario-1"',
    );
  });
});
