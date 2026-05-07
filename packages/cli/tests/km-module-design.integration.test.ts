import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
  return mkdtemp(path.join(os.tmpdir(), "harness-km-module-design-"));
}

describe("harness km-module-design", () => {
  it("prepares prompts, status, and cleans a workflow run", async () => {
    const repo = await createHarnessRepo();
    const { io, stdout, stderr } = createIo();
    const referenceDir = path.join(
      repo,
      "spec-package/shop/productlist/references/kkmp-shop",
    );
    await mkdir(referenceDir, { recursive: true });
    await writeFile(path.join(referenceDir, "architect.md"), "# reviewed\n");

    const prepareExit = await runCli(
      [
        "km-module-design",
        "prepare",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "case",
      ],
      io,
    );

    expect(prepareExit).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Prepared km-module-design workflow");

    const runDir = path.join(
      repo,
      ".harness/runs/km-module-design/shop-productlist-case",
    );
    const specPackDir = path.join(
      repo,
      "spec-package/shop/productlist/spec-pack",
    );
    await expect(
      readFile(path.join(runDir, "workflow.yaml"), "utf8"),
    ).resolves.toContain("parallel_phase:");
    await expect(
      readFile(path.join(specPackDir, "manifest.yaml"), "utf8"),
    ).resolves.toContain("status: draft");
    await expect(
      readFile(path.join(runDir, "prompts/architect.md"), "utf8"),
    ).resolves.toContain("贡献者：architect");
    await expect(
      readFile(path.join(runDir, "prompts/architect.md"), "utf8"),
    ).resolves.toContain("references/**/architect.md");
    await expect(
      readFile(path.join(runDir, "prompts/architect.md"), "utf8"),
    ).resolves.toContain("Markdown 文档必须使用中文正文");
    expect(await exists(path.join(runDir, "prompts/machpro-parity.md"))).toBe(
      true,
    );
    expect(await exists(path.join(runDir, "prompts/tester.md"))).toBe(true);

    const duplicateIo = createIo();
    const duplicateExit = await runCli(
      [
        "km-module-design",
        "prepare",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "case",
      ],
      duplicateIo.io,
    );
    expect(duplicateExit).toBeGreaterThan(0);
    expect(duplicateIo.stderr.join("\n")).toContain("already exists");

    await writeFile(path.join(runDir, "status/architect.md"), "done\n");
    const forceIo = createIo();
    const forceExit = await runCli(
      [
        "km-module-design",
        "prepare",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "case",
        "--force",
      ],
      forceIo.io,
    );
    expect(forceExit).toBe(0);
    expect(await exists(path.join(runDir, "status/architect.md"))).toBe(false);

    const statusIo = createIo();
    const statusExit = await runCli(
      [
        "km-module-design",
        "status",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "case",
      ],
      statusIo.io,
    );

    expect(statusExit).toBe(0);
    expect(statusIo.stdout.join("\n")).toContain("Manifest status: draft");

    const cleanIo = createIo();
    const cleanExit = await runCli(
      [
        "km-module-design",
        "clean",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "case",
        "--include-spec-pack",
      ],
      cleanIo.io,
    );

    expect(cleanExit).toBe(0);
    expect(await exists(runDir)).toBe(false);
    expect(await exists(path.join(repo, "spec-package/shop/productlist"))).toBe(
      false,
    );
  });

  it("runs contributors and integrator with an agent command template", async () => {
    const repo = await createHarnessRepo();
    const { io, stderr } = createIo();
    const command =
      "node -e \"process.exit(require('fs').existsSync(process.argv[1]) ? 0 : 1)\" {prompt_file}";

    const exitCode = await runCli(
      [
        "km-module-design",
        "run",
        "--harness-repo",
        repo,
        "--business",
        "shop",
        "--module",
        "productlist",
        "--run-id",
        "agent-case",
        "--agent-command-template",
        command,
        "--run-integrator",
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(
      await exists(
        path.join(
          repo,
          ".harness/runs/km-module-design/shop-productlist-agent-case/logs/architect.log",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          repo,
          ".harness/runs/km-module-design/shop-productlist-agent-case/logs/architect-integrator.log",
        ),
      ),
    ).toBe(true);
  });

  it("renders named sources and targets in generated artifacts", async () => {
    const repo = await createHarnessRepo();
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      [
        "km-module-design",
        "prepare",
        "--harness-repo",
        repo,
        "--business",
        "commerce",
        "--module",
        "checkout",
        "--run-id",
        "named-resources",
        "--source",
        "monolith=../python-monolith",
        "--source-path",
        "monolith=app/checkout",
        "--source-platform",
        "monolith=python",
        "--target",
        "frontend=../checkout-web",
        "--target",
        "backend=../checkout-api",
        "--target-platform",
        "backend=python-api",
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const runDir = path.join(
      repo,
      ".harness/runs/km-module-design/commerce-checkout-named-resources",
    );
    const specPackDir = path.join(
      repo,
      "spec-package/commerce/checkout/spec-pack",
    );
    const architectPrompt = await readFile(
      path.join(runDir, "prompts/architect.md"),
      "utf8",
    );
    const manifest = await readFile(
      path.join(specPackDir, "manifest.yaml"),
      "utf8",
    );
    const workflow = await readFile(path.join(runDir, "workflow.yaml"), "utf8");

    expect(architectPrompt).toContain(
      "- monolith: path=../python-monolith, subpath=app/checkout, platform=python",
    );
    expect(architectPrompt).toContain(
      "- frontend: path=../checkout-web, subpath=未提供, platform=frontend",
    );
    expect(architectPrompt).toContain(
      "- backend: path=../checkout-api, subpath=未提供, platform=python-api",
    );
    expect(manifest).toContain("sources:\n  monolith:");
    expect(manifest).toContain("targets:\n  frontend:");
    expect(manifest).not.toContain("\nmachpro:\n");
    expect(workflow).toContain("sources:\n  monolith:");
    expect(workflow).toContain("targets:\n  frontend:");
  });
});
