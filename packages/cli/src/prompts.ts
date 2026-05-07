import { stdin as processStdin, stdout as processStdout } from "node:process";
import readline from "node:readline";

import { HarnessError } from "@harness/core";

import type { CliIo } from "./types.js";

export async function promptAdoptCapabilities(
  detectedCapabilities: readonly string[],
  io: CliIo,
): Promise<readonly string[]> {
  if (!processStdin.isTTY || !processStdout.isTTY) {
    throw new HarnessError(
      "`harness adopt --interactive` requires an interactive terminal.",
      "CLI_INTERACTIVE_UNAVAILABLE",
    );
  }

  if (detectedCapabilities.length === 0) {
    return [];
  }

  io.stdout("Interactive adopt mode:");
  const prompt = readline.createInterface({
    input: processStdin,
    output: processStdout,
  });

  try {
    const skipped: string[] = [];

    for (const capability of detectedCapabilities) {
      const answer = (
        await new Promise<string>((resolve) => {
          prompt.question(`Adopt capability ${capability}? [Y/n] `, resolve);
        })
      )
        .trim()
        .toLowerCase();
      if (answer === "n" || answer === "no") {
        skipped.push(capability);
      }
    }

    return skipped;
  } finally {
    prompt.close();
  }
}
