const GITIGNORE_LINES = [
  ".harness/",
  ".claude/settings.local.json",
  ".claude/state/",
  ".claude/sediment/",
  ".claude/scheduled_tasks.lock",
  ".claude/reference-project.local.json",
  ".claude/metrics/events.jsonl",
  ".claude/metrics/events.jsonl.*"
] as const;

export function buildAdoptGitignore(): string {
  return `${GITIGNORE_LINES.join("\n")}\n`;
}
