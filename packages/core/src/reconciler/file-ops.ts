import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlannedContent } from "../sync-types.js";

export function sha256(content: PlannedContent): string {
  return typeof content === "string" ? createHash("sha256").update(content, "utf8").digest("hex") : createHash("sha256").update(content).digest("hex");
}

export async function readBytesIfExists(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function readModeIfExists(filePath: string): Promise<number | undefined> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function atomicWriteFile(filePath: string, content: PlannedContent, mode: number): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);

  await mkdir(directory, { recursive: true });

  if (typeof content === "string") {
    await writeFile(tempPath, content, "utf8");
  } else {
    await writeFile(tempPath, content);
  }

  await chmod(tempPath, mode);
  await rename(tempPath, filePath);
}

export async function atomicWriteText(filePath: string, content: string, mode: number): Promise<void> {
  await atomicWriteFile(filePath, content, mode);
}

export async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
