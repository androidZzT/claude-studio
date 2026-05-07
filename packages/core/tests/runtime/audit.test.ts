import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRunStorePaths,
  runPhaseAudits,
  runPhaseGroupAudit,
} from "../../src/index.js";
import type { PhaseExecutionResult, PhaseSpec } from "../../src/index.js";

function phase(phaseId: string): PhaseSpec {
  return {
    agent: phaseId,
    cwd_ref: "harness",
    parallel_group: "platform",
    phase_id: phaseId,
    tool: "claude-code",
  };
}

function result(
  phaseId: string,
  status: PhaseExecutionResult["status"],
): PhaseExecutionResult {
  return {
    cwd: "/tmp/harness",
    duration_ms: 1,
    exit_code: status === "completed" ? 0 : 1,
    output_path: `/tmp/${phaseId}.md`,
    phase_id: phaseId,
    status,
  };
}

describe("phase group audit", () => {
  it("keeps deterministic findings when an audit judge throws", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "audit-judge-failed-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const reports = await runPhaseAudits({
      auditJudge: async () => {
        throw new Error("judge unavailable");
      },
      outputMd: "# Output\n",
      paths,
      phase: {
        ...phase("design"),
        audit_blocking_policy: "threshold",
        post_phase_audits: [{ audit_id: "semantic", threshold: 0.95 }],
      },
      phaseResult: result("design", "completed"),
      prompt: "review it",
    });

    expect(reports[0]).toMatchObject({
      audit_id: "semantic",
      blocked: true,
      judge_used: true,
      recommendation: "go",
      threshold: 0.95,
    });
    expect(reports[0]?.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "warning",
          message: expect.stringContaining("Audit judge failed"),
        },
      ]),
    );
  });

  it("blocks when a sibling phase failed", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "audit-group-failed-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const report = await runPhaseGroupAudit({
      groupId: "platform",
      paths,
      phases: [phase("android"), phase("ios")],
      results: [result("android", "completed"), result("ios", "failed")],
    });

    expect(report).toMatchObject({
      audit_id: "group-consistency",
      blocked: true,
      critical_count: 1,
      recommendation: "revise",
      score: 0.55,
    });
    await expect(
      readFile(
        path.join(
          paths.auditsDir,
          "_groups",
          "platform",
          "group-consistency.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("Parallel group phase ios ended with status failed");
  });

  it("blocks when a sibling completed artifact is missing", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "audit-group-missing-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );

    const report = await runPhaseGroupAudit({
      groupId: "platform",
      paths,
      phases: [phase("android"), phase("ios")],
      results: [result("android", "completed")],
    });

    expect(report).toMatchObject({
      blocked: true,
      critical_count: 1,
      recommendation: "go",
    });
    expect(report.findings[0]?.message).toContain(
      "missing completed phase artifacts: ios",
    );
  });
});
