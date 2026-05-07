import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function copyFixture(fixturePath: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-fixture-"));
  const workspaceDir = path.join(directory, "workspace");
  await cp(fixturePath, workspaceDir, { recursive: true });
  return workspaceDir;
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
