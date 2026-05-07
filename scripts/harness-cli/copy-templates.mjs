import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "../..");
const sourceDir = path.join(rootDir, "packages/core/src/templates");
const targetDir = path.join(rootDir, "packages/core/dist/templates");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { force: true, recursive: true });
