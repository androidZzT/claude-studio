import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateEvalLog } from "@harness/core";

import { runCli } from "../src/index.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout(message: string): void {
        stdout.push(message);
      },
      stderr(message: string): void {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
}

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);

  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

async function createWorkspace(
  tempRoot: string,
  name = "demo",
): Promise<string> {
  const workspaceDir = path.join(tempRoot, name);

  await withCwd(tempRoot, async () => {
    const initIo = createIo();
    expect(await runCli(["init", name], initIo.io)).toBe(0);
  });

  return workspaceDir;
}

async function writeFakeJsonl(workspaceDir: string): Promise<string> {
  const jsonlPath = path.join(workspaceDir, "fake.jsonl");
  await writeFile(
    jsonlPath,
    [
      '{"timestamp":"2026-04-27T10:00:00Z","type":"user","content":"hello"}',
      '{"timestamp":"2026-04-27T10:00:01Z","type":"assistant","content":"hi"}',
      '{"timestamp":"2026-04-27T10:00:02Z","type":"end"}',
    ].join("\n"),
    "utf8",
  );

  return jsonlPath;
}

describe.sequential("eval ingest integration", () => {
  it("ingests a fake jsonl file with the stub adapter into .harness/logs", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "harness-eval-ingest-"),
    );
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeFakeJsonl(workspaceDir);

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          [
            "eval",
            "ingest",
            jsonlPath,
            "--scenario",
            "test",
            "--source",
            "stub",
            "--json",
          ],
          ingestIo.io,
        ),
      ).toBe(0);

      const parsedResult = JSON.parse(ingestIo.stdout[0] ?? "{}") as {
        readonly outPath: string;
        readonly eventCount: number;
      };
      expect(parsedResult.eventCount).toBe(3);
      expect(path.basename(parsedResult.outPath)).toMatch(/^run_.*\.eval$/);

      const evalLog = JSON.parse(
        await readFile(parsedResult.outPath, "utf8"),
      ) as Record<string, unknown>;
      expect(validateEvalLog(evalLog)).toBe(true);
      expect(evalLog).toMatchObject({
        version: 2,
        eval: {
          metadata: {
            source: "stub",
          },
        },
      });
      expect(
        (evalLog.samples as Record<string, unknown>[])[0]?.events ?? [],
      ).toHaveLength(3);
    });
  });

  it("lists stored eval logs and supports scenario filtering with json output", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "harness-eval-list-"),
    );
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeFakeJsonl(workspaceDir);
    await mkdir(path.join(workspaceDir, ".harness"), { recursive: true });

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          ["eval", "ingest", jsonlPath, "--scenario", "test"],
          ingestIo.io,
        ),
      ).toBe(0);

      const listIo = createIo();
      expect(
        await runCli(["eval", "list", "--scenario", "test"], listIo.io),
      ).toBe(0);
      expect(listIo.stdout[0]).toContain("scenario_id");
      expect(listIo.stdout[1]).toContain("test");

      const listJsonIo = createIo();
      expect(
        await runCli(
          ["eval", "list", "--scenario", "test", "--json"],
          listJsonIo.io,
        ),
      ).toBe(0);
      expect(JSON.parse(listJsonIo.stdout[0] ?? "[]")).toEqual([
        {
          created: expect.any(String),
          event_count: 3,
          run_id: expect.stringMatching(/^run_/),
          scenario_id: "test",
          source: "stub",
        },
      ]);
    });
  });

  it("emits pure JSON for machine-readable ingest output", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "harness-eval-json-"),
    );
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeFakeJsonl(workspaceDir);

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          ["eval", "ingest", jsonlPath, "--scenario", "test", "--json"],
          ingestIo.io,
        ),
      ).toBe(0);
      expect(() => JSON.parse(ingestIo.stdout[0] ?? "{}")).not.toThrow();
      expect(ingestIo.stderr).toEqual([]);
    });
  });

  it("ingests captured run trajectories with --run", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-run-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const runRoot = path.join(workspaceDir, ".harness", "runs", "thread-1");
    await mkdir(path.join(runRoot, "trajectory", "01-design"), {
      recursive: true,
    });
    await writeFile(
      path.join(runRoot, "trajectory", "01-design", "common-events.jsonl"),
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
      ].join("\n"),
      "utf8",
    );

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          ["eval", "ingest", "--run", "thread-1", "--json"],
          ingestIo.io,
        ),
      ).toBe(0);
      const result = JSON.parse(ingestIo.stdout[0] ?? "{}") as {
        readonly eventCount: number;
        readonly phaseCount: number;
      };
      expect(result).toMatchObject({ eventCount: 1, phaseCount: 1 });
    });
  });
});
