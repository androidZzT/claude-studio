import { executeCli } from "./command-strategies.js";
import { defaultDependencies } from "./dependencies.js";
import type { CliDependencies, CliIo } from "./types.js";

export type { CliDependencies, CliIo } from "./types.js";

const defaultIo: CliIo = {
  stdout(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  stderr(message: string): void {
    process.stderr.write(`${message}\n`);
  },
};

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  return executeCli(argv, io, dependencies);
}
