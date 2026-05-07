import { spawn } from "node:child_process";

import type { ProcessResult } from "./types.js";

export async function runProcess(
  command: string,
  argv: readonly string[],
  cwd: string,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stderr: stderr.join(""),
        stdout: stdout.join(""),
      });
    });
  });
}
