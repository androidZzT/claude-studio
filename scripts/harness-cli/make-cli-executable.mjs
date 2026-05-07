import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "../..");
const cliPath = path.join(rootDir, "packages/cli/dist/cli.js");

await chmod(cliPath, 0o755);
