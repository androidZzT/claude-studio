import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
    stderr,
    stdout,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createHarnessRepo(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "harness-km-page-analysis-"));
}

describe("harness km-page-analysis", () => {
  it("prepares a page analysis run with named sources and targets", async () => {
    const repo = await createHarnessRepo();
    const { io, stderr, stdout } = createIo();

    const exitCode = await runCli(
      [
        "km-page-analysis",
        "prepare",
        "--harness-repo",
        repo,
        "--business",
        "commerce",
        "--page",
        "checkout-page",
        "--run-id",
        "named-resources",
        "--source",
        "monolith=../python-monolith",
        "--source-path",
        "monolith=app/checkout",
        "--target",
        "frontend=../checkout-web",
        "--target",
        "backend=../checkout-api",
        "--known-module",
        "cart",
        "--known-modules",
        "pricing,payment",
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Prepared km-page-analysis workflow");

    const runDir = path.join(
      repo,
      ".harness/runs/km-page-analysis/commerce-checkout-page-named-resources",
    );
    const prompt = await readFile(
      path.join(runDir, "prompts/architect.md"),
      "utf8",
    );
    const workflow = await readFile(path.join(runDir, "workflow.yaml"), "utf8");

    expect(await exists(path.join(runDir, "status"))).toBe(true);
    expect(prompt).toContain(
      "- monolith: path=../python-monolith, subpath=app/checkout, platform=monolith",
    );
    expect(prompt).toContain(
      "- frontend: path=../checkout-web, subpath=未提供, platform=frontend",
    );
    expect(prompt).toContain("- cart");
    expect(prompt).toContain("- pricing");
    expect(prompt).toContain("- payment");
    expect(workflow).toContain("sources:\n  monolith:");
    expect(workflow).toContain("targets:\n  frontend:");
    expect(workflow).toContain("backend:");
    expect(workflow).not.toContain("\nmachpro:\n");
  });
});
