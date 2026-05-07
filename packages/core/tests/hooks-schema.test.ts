import { describe, expect, it } from "vitest";

import { CLAUDE_LIFECYCLE_HOOK_NAMES, parseHarnessConfig } from "../src/index.js";

describe("hooks schema", () => {
  it("accepts all known Claude lifecycle hook event names", () => {
    const hookLines = CLAUDE_LIFECYCLE_HOOK_NAMES.map((hookName) => `  ${hookName}:\n    - run: echo ${hookName}`).join("\n");
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
${hookLines}
`);

    expect(Object.keys(config.hooks).sort((left, right) => left.localeCompare(right))).toEqual([...CLAUDE_LIFECYCLE_HOOK_NAMES]);
    for (const hookName of CLAUDE_LIFECYCLE_HOOK_NAMES) {
      expect(config.hooks[hookName]).toEqual([{ enabled: true, run: `echo ${hookName}` }]);
    }
  });

  it("rejects non-positive, non-integer, and non-numeric timeout values", () => {
    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - run: echo done
      timeout: 0
`)
    ).toThrow();

    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - run: echo done
      timeout: -1
`)
    ).toThrow();

    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - run: echo done
      timeout: "15"
`)
    ).toThrow();

    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - run: echo done
      timeout: 1.5
`)
    ).toThrow();
  });

  it("rejects empty lifecycle status messages", () => {
    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - run: echo done
      statusMessage: ""
`)
    ).toThrow();
  });

  it("rejects timeout and statusMessage on git pre-commit hooks", () => {
    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - codex
hooks:
  pre-commit:
    run: echo hi
    timeout: 15
`)
    ).toThrow();

    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - codex
hooks:
  pre-commit:
    run: echo hi
    statusMessage: nope
`)
    ).toThrow();
  });

  it("requires lifecycle hooks to declare run", () => {
    expect(() =>
      parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - matcher: ""
`)
    ).toThrow();
  });

  it("parses lifecycle hooks with timeout and statusMessage", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  TaskCompleted:
    - matcher: ""
      run: bash .claude/scripts/task-completed-check.sh
      timeout: 15
      statusMessage: 检查 review 是否已执行...
`);

    expect(config.hooks.TaskCompleted).toEqual([
      {
        enabled: true,
        matcher: "",
        run: "bash .claude/scripts/task-completed-check.sh",
        timeout: 15,
        statusMessage: "检查 review 是否已执行..."
      }
    ]);
  });
});
