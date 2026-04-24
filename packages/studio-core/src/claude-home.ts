import path from 'node:path';
import os from 'node:os';

export function getClaudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
}

