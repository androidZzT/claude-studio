import { describe, expect, it } from "vitest";

import { runDoctor } from "../src/index.js";
import type { DoctorSystem } from "../src/index.js";

function createSystem(overrides: {
  readonly commands?: Readonly<Record<string, { readonly exitCode: number; readonly output: string }>>;
  readonly scripts?: Readonly<Record<string, { readonly exitCode: number; readonly output: string }>>;
} = {}): DoctorSystem {
  return {
    probe(command: string, args: readonly string[] = []) {
      return overrides.commands?.[`${command} ${args.join(" ")}`] ?? { exitCode: 1, output: "" };
    },
    runScript(script: string) {
      return overrides.scripts?.[script] ?? { exitCode: 1, output: "" };
    }
  };
}

describe("runDoctor", () => {
  it("uses the default system to inspect the current workspace", async () => {
    const report = await runDoctor(process.cwd());

    expect(report.projectName).toBe("harness-cli");
    expect(report.summary.fail).toBe(0);
    expect(report.checks.some((check) => check.id === "node" && check.status === "pass")).toBe(true);
  });

  it("evaluates command and tool requirements", async () => {
    const system = createSystem({
      commands: {
        "node --version": { exitCode: 0, output: "v22.22.0" },
        "npm --version": { exitCode: 0, output: "10.9.4" },
        "git --version": { exitCode: 0, output: "git version 2.50.1" },
        "sqlite3 --version": { exitCode: 0, output: "3.51.0" },
        "codex --version": { exitCode: 0, output: "codex-cli 0.120.0" }
      }
    });

    const report = await runDoctor(process.cwd(), { system });

    expect(report.projectName).toBe("harness-cli");
    expect(report.tools).toEqual(["codex"]);
    expect(report.summary).toEqual({ pass: 5, fail: 0 });
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails when a required version is too low", async () => {
    const system = createSystem({
      commands: {
        "node --version": { exitCode: 0, output: "v18.17.0" },
        "npm --version": { exitCode: 0, output: "10.9.4" },
        "git --version": { exitCode: 0, output: "git version 2.50.1" },
        "sqlite3 --version": { exitCode: 0, output: "3.51.0" },
        "codex --version": { exitCode: 0, output: "codex-cli 0.120.0" }
      }
    });

    const report = await runDoctor(process.cwd(), { system });
    const nodeCheck = report.checks.find((check) => check.id === "node");

    expect(report.summary).toEqual({ pass: 4, fail: 1 });
    expect(nodeCheck).toMatchObject({
      status: "fail",
      minVersion: "20.0.0",
      detectedVersion: "18.17.0"
    });
  });

  it("passes when a required version matches the minimum exactly", async () => {
    const system = createSystem({
      commands: {
        "node --version": { exitCode: 0, output: "v20.0.0" }
      }
    });

    const report = await runDoctor(process.cwd(), {
      configPath: "packages/core/tests/fixtures/exact-version.yaml",
      system
    });

    expect(report.summary).toEqual({ pass: 1, fail: 0 });
    expect(report.checks[0]).toMatchObject({
      id: "node",
      status: "pass",
      minVersion: "20.0.0",
      detectedVersion: "20.0.0"
    });
  });

  it("fails when a required command is missing", async () => {
    const system = createSystem({
      commands: {
        "node --version": { exitCode: 0, output: "v22.22.0" },
        "npm --version": { exitCode: 0, output: "10.9.4" },
        "git --version": { exitCode: 0, output: "git version 2.50.1" },
        "sqlite3 --version": { exitCode: 0, output: "3.51.0" },
        "codex --version": { exitCode: 1, output: "" }
      }
    });

    const report = await runDoctor(process.cwd(), { system });
    const codexCheck = report.checks.find((check) => check.id === "codex");

    expect(report.summary).toEqual({ pass: 4, fail: 1 });
    expect(codexCheck).toMatchObject({
      status: "fail",
      installHint: "npm install -g @openai/codex"
    });
  });

  it("evaluates script requirements from config", async () => {
    const report = await runDoctor(process.cwd(), {
      configPath: "packages/core/tests/fixtures/script-check.yaml"
    });

    expect(report.summary).toEqual({ pass: 1, fail: 0 });
    expect(report.checks[0]).toMatchObject({
      id: "custom-check",
      kind: "script",
      status: "pass"
    });
  });

  it("reports script failures from config", async () => {
    const report = await runDoctor(process.cwd(), {
      configPath: "packages/core/tests/fixtures/script-fail.yaml"
    });

    expect(report.summary).toEqual({ pass: 0, fail: 1 });
    expect(report.checks[0]).toMatchObject({
      id: "broken-script",
      kind: "script",
      status: "fail"
    });
  });
});
