import { EventEmitter } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runGateCommand, validateGateCommand } from "../../src/index.js";
import type { GateCommand, GateCommandSpawn } from "../../src/index.js";

function createMockSpawn(exitCode = 0): {
  readonly calls: unknown[];
  readonly spawnImpl: GateCommandSpawn;
} {
  const calls: unknown[] = [];
  const spawnImpl: GateCommandSpawn = (file, args, options) => {
    calls.push({ file, args, options });

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;

    queueMicrotask(() => {
      stdout.end("stdout ok");
      stderr.end("stderr ok");
      child.emit("close", exitCode, null);
    });

    return child;
  };

  return { calls, spawnImpl };
}

function createCommand(overrides: Partial<GateCommand> = {}): GateCommand {
  return {
    argv: ["npm", "test"],
    cwd_ref: "harness",
    id: "test",
    kind: "test",
    timeout_seconds: 10,
    ...overrides,
  };
}

describe("safe command runner", () => {
  it("spawns argv commands with shell disabled and captures output", async () => {
    const { calls, spawnImpl } = createMockSpawn();
    const result = await runGateCommand(createCommand(), {
      cwd: "/tmp/harness",
      spawnImpl,
    });

    expect(calls).toEqual([
      {
        file: "npm",
        args: ["test"],
        options: {
          cwd: "/tmp/harness",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      },
    ]);
    expect(result).toMatchObject({
      argv: ["npm", "test"],
      cwd: "/tmp/harness",
      exit_code: 0,
      id: "test",
      kind: "test",
      signal: null,
      stderr: "stderr ok",
      stdout: "stdout ok",
      timed_out: false,
    });
  });

  it("injects Android SDK env for Android Gradle gates from well-known paths", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "harness-android-sdk-"),
    );
    const sdkDir = path.join(tempDir, "sdk");
    await mkdir(sdkDir);
    const { calls, spawnImpl } = createMockSpawn();

    const result = await runGateCommand(
      createCommand({
        argv: ["./gradlew", ":shop:compileDebugKotlin"],
        cwd_ref: "target:android",
        id: "android-shop-compile",
        kind: "compile",
      }),
      {
        android_sdk_search_paths: [sdkDir],
        cwd: tempDir,
        spawnImpl,
      },
    );

    expect(result).toMatchObject({
      environment: {
        android_sdk: {
          path: sdkDir,
          source: "well-known",
          status: "configured",
        },
      },
      exit_code: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      options: {
        env: expect.objectContaining({
          ANDROID_HOME: sdkDir,
          ANDROID_SDK_ROOT: sdkDir,
        }),
      },
    });
  });

  it("classifies missing Android SDK as an environment-blocked gate", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "harness-android-missing-"),
    );
    const { calls, spawnImpl } = createMockSpawn();

    const result = await runGateCommand(
      createCommand({
        argv: ["./gradlew", ":shop:compileDebugKotlin"],
        cwd_ref: "target:android",
        id: "android-shop-compile",
        kind: "compile",
      }),
      {
        android_sdk_search_paths: [],
        cwd: tempDir,
        spawnImpl,
      },
    );

    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      environment: {
        android_sdk: {
          status: "missing",
        },
      },
      exit_code: 1,
      failure_category: "environment_blocked",
      stderr: expect.stringContaining("Android SDK location not found"),
      timed_out: false,
    });
  });

  it("classifies failed env gates as environment-blocked", async () => {
    const { spawnImpl } = createMockSpawn(1);

    const result = await runGateCommand(
      createCommand({
        argv: ["node", "--bad-option"],
        id: "env-check",
        kind: "env",
      }),
      {
        cwd: "/tmp/harness",
        spawnImpl,
      },
    );

    expect(result).toMatchObject({
      exit_code: 1,
      failure_category: "environment_blocked",
      id: "env-check",
      kind: "env",
    });
  });

  it("rejects empty argv and shell metacharacters in the executable", () => {
    expect(() => validateGateCommand(createCommand({ argv: [] }))).toThrow(
      /must declare argv/,
    );
    expect(() =>
      validateGateCommand(createCommand({ argv: ["npm;rm", "test"] })),
    ).toThrow(/shell metacharacters/);
    expect(() =>
      validateGateCommand(createCommand({ argv: ["$(npm)", "test"] })),
    ).toThrow(/shell metacharacters/);
  });

  it("rejects destructive, network, and git write commands", () => {
    for (const argv of [
      ["rm", "-rf", "dist"],
      ["mv", "a", "b"],
      ["curl", "https://example.com"],
      ["wget", "https://example.com"],
      ["ssh", "host"],
      ["scp", "a", "b"],
      ["git", "commit"],
      ["git", "push"],
      ["git", "reset"],
      ["git", "checkout"],
    ]) {
      expect(() => validateGateCommand(createCommand({ argv }))).toThrow(
        /blocked|git/,
      );
    }
  });
});
