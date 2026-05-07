import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDriftCheckpointPrompt, getRunStorePaths, runDriftCheckpoint } from "../../src/index.js";
import type { CheckpointJudge } from "../../src/index.js";

function decision(decisionValue: "go" | "revise" | "escalate", extras: Record<string, unknown> = {}): string {
  return JSON.stringify({
    decision: decisionValue,
    confidence: 0.9,
    reasoning: "Done.",
    semantic_findings: [],
    ...extras
  });
}

async function createPaths(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const paths = getRunStorePaths(path.join(root, ".harness", "runs", "thread-1"));
  await mkdir(paths.checkpointsDir, { recursive: true });
  return paths;
}

describe("drift checkpoint", () => {
  it("builds drift input from brief, phase graph, and bounded phase outputs only", () => {
    const prompt = buildDriftCheckpointPrompt({
      briefMd: "# Brief\nBuild checkout.",
      phaseGraphSummary: "architect -> android",
      phaseOutputs: [
        {
          phase_id: "01-architect",
          output_md: `# Design\n${"A".repeat(11_000)}`
        }
      ]
    });

    expect(prompt).toContain("# Brief\nBuild checkout.");
    expect(prompt).toContain("architect -> android");
    expect(prompt).toContain("## Phase Output: 01-architect");
    expect(prompt).toContain("[truncated by harness drift checkpoint]");
    expect(prompt).not.toContain("stdout.log");
    expect(prompt).not.toContain("stderr.log");
  });

  it("uses deterministic heading-preserving summaries when the prompt exceeds budget", () => {
    const prompt = buildDriftCheckpointPrompt({
      briefMd: "# Brief\nBuild checkout.",
      maxInputChars: 1500,
      phaseGraphSummary: "architect -> android",
      phaseOutputs: [
        {
          phase_id: "01-architect",
          output_md: `# Design\n## State\n${"A".repeat(20_000)}`
        }
      ]
    });

    expect(prompt).toContain("Headings:\n# Design\n## State");
    expect(prompt.length).toBeLessThanOrEqual(1550);
  });

  it("proceeds for a normal drift fixture", async () => {
    const paths = await createPaths("drift-go-");
    const judge: CheckpointJudge = async () => ({
      text: decision("go")
    });

    const result = await runDriftCheckpoint({
      briefMd: "Build checkout.",
      checkpointId: "drift",
      judge,
      paths,
      phaseGraphSummary: "architect -> android",
      phaseOutputs: [{ phase_id: "01-architect", output_md: "# Output\nCheckout implemented." }]
    });

    expect(result.decision.decision).toBe("go");
  });

  it("escalates for a brief/output mismatch fixture", async () => {
    const paths = await createPaths("drift-escalate-");
    const judge: CheckpointJudge = async () => ({
      text: decision("escalate", {
        confidence: 0.8,
        reasoning: "Output implemented wishlist instead of checkout.",
        escalate_question_md: "The output diverged from the brief. Stop or revise?"
      })
    });

    const result = await runDriftCheckpoint({
      briefMd: "Build checkout.",
      checkpointId: "drift",
      judge,
      paths,
      phaseGraphSummary: "architect -> android",
      phaseOutputs: [{ phase_id: "01-architect", output_md: "# Output\nWishlist implemented." }]
    });

    expect(result.decision).toMatchObject({
      decision: "escalate",
      reasoning: "Output implemented wishlist instead of checkout."
    });
  });

  it("converts forbidden revise decisions to escalate and persists that decision", async () => {
    const paths = await createPaths("drift-revise-");
    const judge: CheckpointJudge = async () => ({
      text: decision("revise", {
        revise_target_phase: "architect",
        revise_feedback_md: "Revise the plan."
      })
    });

    const result = await runDriftCheckpoint({
      briefMd: "Build checkout.",
      checkpointId: "drift",
      judge,
      paths,
      phaseGraphSummary: "architect -> android",
      phaseOutputs: [{ phase_id: "01-architect", output_md: "# Output\nCheckout implemented." }]
    });

    expect(result.decision).toMatchObject({
      decision: "escalate",
      reasoning: "Drift checkpoint returned revise, which is not allowed."
    });
    await expect(readFile(path.join(paths.checkpointsDir, "drift", "decision.json"), "utf8")).resolves.toContain(
      "Drift checkpoint returned revise"
    );
  });
});
