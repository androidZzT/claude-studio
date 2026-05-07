import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRunStorePaths,
  loadRunState,
  recoverCorruptedRunState,
  resumeRunFromDecision,
  saveRunState,
  writeEscalationRequest
} from "../../src/index.js";
import type { RunState } from "../../src/index.js";

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    estimated_dollars: 0,
    escalation_counts: {},
    run_id: "run-1",
    started_at_iso: "2026-05-03T10:00:00.000Z",
    status: "running",
    thread_id: "thread-1",
    ...overrides
  };
}

async function createPaths(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const paths = getRunStorePaths(path.join(root, ".harness", "runs", "thread-1"));
  await mkdir(paths.rootDir, { recursive: true });
  return paths;
}

describe("file pause/resume protocol", () => {
  it("writes an escalation request and marks the run paused", async () => {
    const paths = await createPaths("pause-resume-request-");
    await saveRunState(paths, state());

    const result = await writeEscalationRequest(paths, "01-02", "Need a decision.\n", {
      nowIso: () => "2026-05-03T10:01:00.000Z"
    });

    expect(result.status).toBe("paused");
    expect(result.requestPath).toBe(path.join(paths.notificationsDir, "2026-05-03T10-01-00-000Z.request.md"));
    await expect(readFile(result.requestPath!, "utf8")).resolves.toBe("Need a decision.\n");
    await expect(loadRunState(paths)).resolves.toMatchObject({
      current_checkpoint_id: "01-02",
      escalation_counts: {
        "01-02": 1
      },
      pending_request_path: result.requestPath,
      status: "paused"
    });
  });

  it("resumes a paused run when a valid decision file exists", async () => {
    const paths = await createPaths("pause-resume-valid-");
    await saveRunState(paths, state());
    const pause = await writeEscalationRequest(paths, "01-02", "Need a decision.\n", {
      nowIso: () => "2026-05-03T10:01:00.000Z"
    });
    await writeFile(pause.requestPath!.replace(".request.md", ".decision.md"), "Continue.\n", "utf8");

    const resumedState = await resumeRunFromDecision(paths);

    expect(resumedState.status).toBe("running");
    expect(resumedState.pending_request_path).toBeUndefined();
    await expect(loadRunState(paths)).resolves.toMatchObject({
      status: "running"
    });
  });

  it("rejects resume for completed and failed runs", async () => {
    const completedPaths = await createPaths("pause-resume-completed-");
    const failedPaths = await createPaths("pause-resume-failed-");
    await saveRunState(completedPaths, state({ status: "completed" }));
    await saveRunState(failedPaths, state({ status: "failed" }));

    await expect(resumeRunFromDecision(completedPaths)).rejects.toMatchObject({
      code: "RUN_RESUME_INVALID_STATUS"
    });
    await expect(resumeRunFromDecision(failedPaths)).rejects.toMatchObject({
      code: "RUN_RESUME_INVALID_STATUS"
    });
  });

  it("recovers missing or corrupted state by writing a review request", async () => {
    const paths = await createPaths("pause-resume-corrupt-");
    await mkdir(path.join(paths.phasesDir, "01-architect"), { recursive: true });
    await writeFile(paths.statePath, "{bad json", "utf8");

    const result = await recoverCorruptedRunState(paths, {
      nowIso: () => "2026-05-03T10:02:00.000Z"
    });

    expect(result.status).toBe("paused");
    expect(result.state.status).toBe("needs_user_review");
    await expect(readFile(result.requestPath!, "utf8")).resolves.toContain("`01-architect`");
    await expect(loadRunState(paths)).resolves.toMatchObject({
      current_checkpoint_id: "state-recovery",
      status: "needs_user_review"
    });
  });

  it("routes the same checkpoint escalated twice to failure summary", async () => {
    const paths = await createPaths("pause-resume-double-escalate-");
    await saveRunState(paths, state());
    await writeEscalationRequest(paths, "01-02", "Need a decision.\n", {
      nowIso: () => "2026-05-03T10:01:00.000Z"
    });

    const result = await writeEscalationRequest(paths, "01-02", "Need another decision.\n", {
      nowIso: () => "2026-05-03T10:02:00.000Z"
    });

    expect(result.status).toBe("failed");
    expect(result.requestPath).toBeUndefined();
    expect(result.summaryPath).toBe(path.join(paths.rootDir, "summary.md"));
    await expect(readFile(result.summaryPath!, "utf8")).resolves.toContain("escalated twice");
    await expect(loadRunState(paths)).resolves.toMatchObject({
      current_checkpoint_id: "01-02",
      escalation_counts: {
        "01-02": 2
      },
      status: "failed"
    });
  });
});
