import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadTaskCard,
  pathPatternMatches,
  taskCardSchema,
} from "../../src/index.js";

describe("TaskCard", () => {
  it("loads and hashes a YAML task card", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "task-card-"));
    const taskCardPath = path.join(repo, "task-card.yaml");
    await writeFile(
      taskCardPath,
      [
        "goal: Build bounded infra",
        "acceptance_criteria:",
        "  - Tests pass",
        "allowed_paths:",
        "  - src/**",
        "denied_actions:",
        "  - no release",
        "test_commands:",
        "  - npm test",
        "risk_level: medium",
        "budget:",
        "  max_tokens: 1000",
        "human_review_required: true",
        "context_paths:",
        "  - docs/design.md",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadTaskCard(repo, "task-card.yaml");

    expect(loaded.path).toBe(taskCardPath);
    expect(loaded.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.taskCard.goal).toBe("Build bounded infra");
  });

  it("rejects absolute or traversal allowed paths", () => {
    expect(() =>
      taskCardSchema.parse({
        acceptance_criteria: ["done"],
        allowed_paths: ["../secret"],
        budget: {},
        context_paths: [],
        denied_actions: [],
        goal: "bad",
        human_review_required: false,
        risk_level: "low",
        test_commands: [],
      }),
    ).toThrow();
  });

  it("matches simple bounded path patterns", () => {
    expect(pathPatternMatches("src/**", "src/runtime/a.ts")).toBe(true);
    expect(pathPatternMatches("src/*", "src/a.ts")).toBe(true);
    expect(pathPatternMatches("src/*", "src/runtime/a.ts")).toBe(false);
    expect(pathPatternMatches("docs", "docs/readme.md")).toBe(true);
  });
});
