import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRunStorePaths,
  validatePhaseResultArtifact,
} from "../../src/index.js";
import type { PhaseExecutionResult, PhaseSpec, TaskCard } from "../../src/index.js";

function phaseResult(outputPath: string): PhaseExecutionResult {
  return {
    cwd: "",
    duration_ms: 1,
    exit_code: 0,
    output_path: outputPath,
    phase_id: "design",
    signal: null,
    status: "completed",
  };
}

const phase: PhaseSpec = {
  agent: "architect",
  cwd_ref: "harness",
  phase_id: "design",
  tool: "claude-code",
};

const taskCard: TaskCard = {
  acceptance_criteria: ["done"],
  allowed_paths: ["src/**"],
  budget: {},
  context_paths: [],
  denied_actions: [],
  goal: "bounded",
  human_review_required: false,
  risk_level: "low",
  test_commands: [],
};

describe("phase result validation", () => {
  it("synthesizes result.json when the phase did not write one", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "phase-result-"));
    const paths = getRunStorePaths(runRoot);
    await mkdir(path.join(paths.phasesDir, "design"), { recursive: true });
    const outputPath = path.join(paths.phasesDir, "design", "output.md");
    await writeFile(outputPath, "# ok\n", "utf8");

    const report = await validatePhaseResultArtifact({
      cwd: runRoot,
      paths,
      phase,
      phaseResult: phaseResult(outputPath),
      taskCard,
    });

    expect(report).toMatchObject({
      status: "pass",
      synthesized: true,
    });
    await expect(
      readFile(path.join(paths.phasesDir, "design", "result.json"), "utf8"),
    ).resolves.toContain('"status": "OK"');
  });

  it("marks changed_files outside TaskCard allowed paths as critical", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "phase-result-"));
    const paths = getRunStorePaths(runRoot);
    await mkdir(path.join(paths.phasesDir, "design"), { recursive: true });
    const outputPath = path.join(paths.phasesDir, "design", "output.md");
    await writeFile(outputPath, "# ok\n", "utf8");
    await writeFile(
      path.join(paths.phasesDir, "design", "result.json"),
      JSON.stringify(
        {
          changed_files: ["secrets/token.txt"],
          commands_run: [],
          next_action: "stop",
          risk_flags: [],
          status: "OK",
          summary: "changed file",
          tests: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const report = await validatePhaseResultArtifact({
      cwd: runRoot,
      paths,
      phase,
      phaseResult: phaseResult(outputPath),
      taskCard,
    });

    expect(report.status).toBe("critical");
    expect(report.findings[0]?.code).toBe("changed_file_outside_allowed_paths");
  });

  it("blocks invalid result JSON and missing required artifacts", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "phase-result-"));
    const paths = getRunStorePaths(runRoot);
    await mkdir(path.join(paths.phasesDir, "design"), { recursive: true });
    const outputPath = path.join(paths.phasesDir, "design", "output.md");
    await writeFile(outputPath, "# ok\n", "utf8");
    await writeFile(
      path.join(paths.phasesDir, "design", "result.json"),
      JSON.stringify({ status: "OK" }),
      "utf8",
    );

    const report = await validatePhaseResultArtifact({
      cwd: runRoot,
      paths,
      phase: {
        ...phase,
        required_artifacts: ["docs/missing.md", "../unsafe.md"],
      },
      phaseResult: phaseResult(outputPath),
      taskCard,
    });

    expect(report.status).toBe("critical");
    expect(report.findings.map((finding) => finding.code)).toEqual([
      "result_json_invalid",
      "required_artifact_missing",
      "required_artifact_path_unsafe",
    ]);
  });
});
