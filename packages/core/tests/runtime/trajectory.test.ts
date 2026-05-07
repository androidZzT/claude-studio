import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { capturePhaseTrajectory, getRunStorePaths } from "../../src/index.js";
import type { PhaseSpec } from "../../src/index.js";

function phase(overrides: Partial<PhaseSpec>): PhaseSpec {
  return {
    agent: "architect",
    cwd_ref: "harness",
    phase_id: "01-design",
    tool: "codex",
    ...overrides,
  };
}

describe("phase trajectory capture", () => {
  it("writes a skipped summary when trajectory capture is disabled", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "trajectory-skip-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const summary = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ trajectory_capture: false }),
      promptSha256: "abc",
      startedAtIso: "2026-05-06T00:00:00.000Z",
    });

    expect(summary).toMatchObject({
      status: "skipped",
      prompt_sha256: "abc",
      usage_reliable: true,
    });
    await expect(
      readFile(
        path.join(paths.trajectoryDir, "01-design", "summary.json"),
        "utf8",
      ),
    ).resolves.toContain("trajectory_capture disabled");
  });

  it("marks unsupported tools and missing raw files without throwing", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "trajectory-missing-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const unsupported = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "01-cursor", tool: "cursor" }),
    });
    const missing = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "02-codex" }),
      promptSha256: "missing-fingerprint",
      sessionId: "missing-session",
      startedAtMs: Date.now() - 1_000,
      completedAtMs: Date.now(),
    });

    expect(unsupported).toMatchObject({
      status: "missing",
      reason: "unsupported trajectory source for tool cursor",
    });
    expect(missing).toMatchObject({
      status: "missing",
      reason: "no codex trajectory found for session missing-session",
      session_id: "missing-session",
    });
  });

  it("explains missing trajectories by fingerprint, time window, or absent session", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "trajectory-reasons-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const byFingerprint = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "01-fingerprint" }),
      promptSha256: "abc",
    });
    const byWindow = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "02-window" }),
      startedAtMs: Date.now() - 1_000,
      completedAtMs: Date.now(),
    });
    const byMissingSession = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "03-session" }),
    });

    expect(byFingerprint.reason).toBe(
      "no codex trajectory found for phase fingerprint abc",
    );
    expect(byWindow.reason).toBe(
      "no codex trajectory found in phase time window",
    );
    expect(byMissingSession.reason).toBe("session_id missing");
  });

  it("marks an explicit unreadable raw trajectory as fingerprint-missing", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "trajectory-failed-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const summary = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "01-failed" }),
      promptSha256: "abc",
      rawTrajectoryPath: path.join(repo, "missing.jsonl"),
      sessionId: "codex-session",
    });

    expect(summary).toMatchObject({
      status: "missing",
      raw_path: path.join(repo, "missing.jsonl"),
      session_id: "codex-session",
      usage_reliable: true,
    });
  });

  it("records a failed summary when explicit raw trajectory parsing throws", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "trajectory-parse-failed-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const summary = await capturePhaseTrajectory({
      cwd: repo,
      paths,
      phase: phase({ phase_id: "01-failed" }),
      rawTrajectoryPath: repo,
      sessionId: "codex-session",
    });

    expect(summary).toMatchObject({
      status: "failed",
      raw_path: repo,
      session_id: "codex-session",
      usage_reliable: true,
    });
  });
});
