import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateRunVisualization,
  getRunStorePaths,
  inspectRunStore,
  renderRunInspectionText,
} from "../../src/index.js";

describe("run report", () => {
  it("inspects phase artifacts and writes static HTML plus Mermaid workflow", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "run-report-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(path.join(paths.phasesDir, "01-design"), { recursive: true });
    await mkdir(path.join(paths.auditsDir, "01-design"), { recursive: true });
    await mkdir(path.join(paths.trajectoryDir, "01-design"), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.phasesDir, "01-design", "session.json"),
      JSON.stringify({
        phase_id: "01-design",
        agent: "architect",
        mode: "plan",
        tool: "codex",
        status: "completed",
        session_id: "s1",
      }),
      "utf8",
    );
    await writeFile(
      path.join(paths.phasesDir, "01-design", "exit_code.json"),
      JSON.stringify({
        status: "completed",
        duration_ms: 12,
        exit_code: 0,
        output_path: "/tmp/output.md",
      }),
      "utf8",
    );
    await writeFile(
      path.join(paths.auditsDir, "01-design", "default.json"),
      JSON.stringify({
        audit_id: "default",
        score: 0.9,
        critical_count: 0,
        blocked: false,
        recommendation: "go",
      }),
      "utf8",
    );
    await writeFile(
      path.join(paths.trajectoryDir, "01-design", "summary.json"),
      JSON.stringify({
        status: "captured",
        event_count: 3,
        tool_call_count: 1,
        total_tokens: 25,
        final_output_preview: "done",
      }),
      "utf8",
    );

    const report = await inspectRunStore(paths);
    expect(report.phases).toHaveLength(1);
    expect(report.phases[0]).toMatchObject({
      phase_id: "01-design",
      status: "completed",
      mode: "plan",
      audits: [{ score: 0.9 }],
      trajectory: { status: "captured", event_count: 3 },
    });
    expect(renderRunInspectionText(report).join("\n")).toContain(
      "status=completed mode=plan score=0.9",
    );

    const visualization = await generateRunVisualization(paths);
    await expect(
      readFile(visualization.mermaid_path, "utf8"),
    ).resolves.toContain("flowchart TD");
    await expect(readFile(visualization.html_path, "utf8")).resolves.toContain(
      "Harness Run Report",
    );
    await expect(readFile(visualization.html_path, "utf8")).resolves.toContain(
      "<td>plan</td>",
    );
  });

  it("orders phases by phase_graph.json before falling back to directory names", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "run-report-graph-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await mkdir(path.join(paths.phasesDir, "99-second"), { recursive: true });
    await mkdir(path.join(paths.phasesDir, "01-first"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(paths.phasesDir, "99-second", "exit_code.json"),
        JSON.stringify({ status: "completed" }),
        "utf8",
      ),
      writeFile(
        path.join(paths.phasesDir, "01-first", "exit_code.json"),
        JSON.stringify({ status: "completed" }),
        "utf8",
      ),
      writeFile(
        path.join(paths.rootDir, "phase_graph.json"),
        JSON.stringify([
          {
            index: 0,
            phase_id: "99-second",
            parallel_group: "platform",
          },
          {
            index: 1,
            phase_id: "01-first",
          },
        ]),
        "utf8",
      ),
    ]);

    const report = await inspectRunStore(paths);

    expect(report.phases.map((phase) => phase.phase_id)).toEqual([
      "99-second",
      "01-first",
    ]);
    expect(renderRunInspectionText(report).join("\n")).toContain(
      "99-second status=completed",
    );
  });
});
