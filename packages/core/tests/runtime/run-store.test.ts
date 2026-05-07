import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquireRunLock,
  appendRunEvent,
  getDefaultRunRoot,
  getRunStorePaths,
  initializeRunStore,
  inspectRunLiveness,
  isPathIgnoredByGitignore,
  preflightRunRoot,
  recomputeEstimatedDollars,
  repairInterruptedPhaseArtifacts,
  runStorePathExists,
} from "../../src/index.js";
import type { RunStoreProcessInfo } from "../../src/index.js";

async function createRepo(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

function processInfo(
  overrides: Partial<RunStoreProcessInfo> = {},
): RunStoreProcessInfo {
  return {
    hostname: "test-host",
    isPidAlive: () => false,
    nowIso: () => "2026-05-03T10:00:00.000Z",
    pid: 123,
    ...overrides,
  };
}

describe("run store", () => {
  it("preflights default and custom run roots against gitignore", async () => {
    const repo = await createRepo("run-store-preflight-");
    const defaultRunRoot = getDefaultRunRoot(repo, "thread-1");

    await expect(isPathIgnoredByGitignore(repo, defaultRunRoot)).resolves.toBe(
      false,
    );
    await expect(preflightRunRoot(repo, defaultRunRoot)).rejects.toMatchObject({
      code: "RUN_ROOT_NOT_IGNORED",
    });

    await writeFile(path.join(repo, ".gitignore"), ".harness/\n", "utf8");
    await expect(isPathIgnoredByGitignore(repo, defaultRunRoot)).resolves.toBe(
      true,
    );
    await expect(
      preflightRunRoot(repo, defaultRunRoot),
    ).resolves.toBeUndefined();

    await expect(
      preflightRunRoot(repo, path.join(repo, "runs", "thread-1")),
    ).rejects.toMatchObject({
      code: "RUN_ROOT_NOT_IGNORED",
    });
    await expect(
      preflightRunRoot(
        repo,
        path.join(repo, "..", "external-runs", "thread-1"),
      ),
    ).resolves.toBeUndefined();
  });

  it("initializes run directories, state, events, and lock schema", async () => {
    const repo = await createRepo("run-store-init-");
    await writeFile(path.join(repo, ".gitignore"), ".harness/\n", "utf8");

    const { lock, paths } = await initializeRunStore({
      brief: "# Brief\n",
      harnessRepoPath: repo,
      processInfo: processInfo(),
      runId: "run-1",
      threadId: "thread-1",
    });
    const state = await readJson(paths.statePath);
    const events = (await readFile(paths.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lock).toEqual({
      pid: 123,
      hostname: "test-host",
      started_at_iso: "2026-05-03T10:00:00.000Z",
      run_id: "run-1",
    });
    expect(state).toEqual({
      estimated_dollars: 0,
      run_id: "run-1",
      started_at_iso: "2026-05-03T10:00:00.000Z",
      status: "running",
      thread_id: "thread-1",
    });
    expect(events).toEqual([
      {
        ts: "2026-05-03T10:00:00.000Z",
        kind: "resume",
        phase_id: "run-store",
        payload: {
          status: "initialized",
        },
      },
    ]);
    await expect(
      readFile(path.join(paths.rootDir, "brief.md"), "utf8"),
    ).resolves.toBe("# Brief\n");
    await expect(runStorePathExists(paths.auditsDir)).resolves.toBe(true);
    await expect(runStorePathExists(paths.phasesDir)).resolves.toBe(true);
    await expect(runStorePathExists(paths.trajectoryDir)).resolves.toBe(true);
    await expect(runStorePathExists(paths.visualizationDir)).resolves.toBe(
      true,
    );
    await expect(runStorePathExists(paths.gatesDir)).resolves.toBe(true);
    await expect(runStorePathExists(paths.checkpointsDir)).resolves.toBe(true);
    await expect(runStorePathExists(paths.notificationsDir)).resolves.toBe(
      true,
    );
  });

  it("prevents concurrent lock ownership and clears stale same-host locks", async () => {
    const repo = await createRepo("run-store-lock-");
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(paths.rootDir, { recursive: true });

    await acquireRunLock(
      paths,
      "run-1",
      processInfo({ isPidAlive: () => true }),
    );
    await expect(
      acquireRunLock(
        paths,
        "run-1",
        processInfo({ pid: 456, isPidAlive: () => true }),
      ),
    ).rejects.toMatchObject({
      code: "RUN_LOCK_HELD",
    });
    await expect(
      acquireRunLock(
        paths,
        "run-1",
        processInfo({ pid: 123, isPidAlive: () => true }),
      ),
    ).resolves.toMatchObject({
      pid: 123,
    });

    const staleReplacement = await acquireRunLock(
      paths,
      "run-2",
      processInfo({
        pid: 456,
        isPidAlive: () => false,
        nowIso: () => "2026-05-03T10:01:00.000Z",
      }),
    );

    expect(staleReplacement).toEqual({
      pid: 456,
      hostname: "test-host",
      started_at_iso: "2026-05-03T10:01:00.000Z",
      run_id: "run-2",
    });
  });

  it("reports liveness and repairs interrupted phase artifacts", async () => {
    const repo = await createRepo("run-store-liveness-");
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(path.join(paths.phasesDir, "01-design"), { recursive: true });
    await writeFile(
      paths.statePath,
      JSON.stringify({ status: "running" }),
      "utf8",
    );
    await acquireRunLock(paths, "run-1", processInfo());
    await writeFile(
      path.join(paths.phasesDir, "01-design", "prompt.md"),
      "# Prompt\n",
      "utf8",
    );
    await writeFile(
      path.join(paths.phasesDir, "01-design", "stdout.log"),
      "line 1\nstdout tail\n",
      "utf8",
    );
    await writeFile(
      path.join(paths.phasesDir, "01-design", "stderr.log"),
      "stderr tail\n",
      "utf8",
    );

    await expect(
      inspectRunLiveness(paths, processInfo({ isPidAlive: () => false })),
    ).resolves.toMatchObject({ liveness: "stale" });

    await expect(repairInterruptedPhaseArtifacts(paths)).resolves.toEqual([
      "01-design",
    ]);
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-design", "partial-output.md"),
        "utf8",
      ),
    ).resolves.toContain("reason: interrupted");
    await expect(
      readJson(path.join(paths.phasesDir, "01-design", "exit_code.json")),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "interrupted",
    });
  });

  it("appends schema-valid events only when the run lock is owned", async () => {
    const repo = await createRepo("run-store-events-");
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(paths.rootDir, { recursive: true });
    await acquireRunLock(paths, "run-1", processInfo());

    await appendRunEvent(
      paths,
      "run-1",
      {
        ts: "2026-05-03T10:02:00.000Z",
        kind: "phase_start",
        phase_id: "architect",
        payload: {
          cwd_ref: "harness",
        },
      },
      processInfo(),
    );
    await expect(
      appendRunEvent(
        paths,
        "run-1",
        {
          ts: "2026-05-03T10:03:00.000Z",
          kind: "phase_end",
          phase_id: "architect",
          payload: {},
        },
        processInfo({ pid: 999 }),
      ),
    ).rejects.toMatchObject({
      code: "RUN_LOCK_NOT_OWNED",
    });

    await expect(readFile(paths.eventsPath, "utf8")).resolves.toBe(
      '{"ts":"2026-05-03T10:02:00.000Z","kind":"phase_start","phase_id":"architect","payload":{"cwd_ref":"harness"}}\n',
    );
  });

  it("aggregates phase and checkpoint cost files into estimated dollars", async () => {
    const repo = await createRepo("run-store-cost-");
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(path.join(paths.phasesDir, "01-architect"), {
      recursive: true,
    });
    await mkdir(path.join(paths.checkpointsDir, "01-02"), { recursive: true });
    await writeFile(
      path.join(paths.phasesDir, "01-architect", "cost.json"),
      JSON.stringify({
        tokens_in: 100,
        tokens_out: 50,
        model: "gpt",
        dollars: 1.25,
      }),
      "utf8",
    );
    await writeFile(
      path.join(paths.checkpointsDir, "01-02", "cost.json"),
      JSON.stringify({
        tokens_in: 10,
        tokens_out: 5,
        model: "judge",
        dollars: 0.75,
      }),
      "utf8",
    );

    await expect(recomputeEstimatedDollars(paths)).resolves.toBe(2);
  });
});
