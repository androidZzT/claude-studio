import path from 'node:path';
import os from 'node:os';

/**
 * Expands a leading `~` or `~/` in a path to the user's home directory.
 */
export function expandHome(input: string): string {
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === '~') {
    return os.homedir();
  }
  return input;
}

