import { readFile } from "node:fs/promises";

interface VersionFile {
  readonly version?: string;
}

export function parseCliVersion(source: string): string {
  const parsed = JSON.parse(source) as VersionFile;
  return parsed.version ?? "0.0.0";
}

export async function loadCliVersion(): Promise<string> {
  const packageUrl = new URL("../package.json", import.meta.url);
  const source = await readFile(packageUrl, "utf8");
  return parseCliVersion(source);
}
