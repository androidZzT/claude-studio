import { spawnSync } from "node:child_process";

import type { HarnessConfig, ToolName } from "./harness-config.js";
import { loadHarnessConfig } from "./harness-config.js";

export type DoctorStatus = "pass" | "fail";

export interface DoctorCheck {
  readonly id: string;
  readonly kind: "command" | "script";
  readonly status: DoctorStatus;
  readonly message: string;
  readonly installHint?: string;
  readonly detectedVersion?: string;
  readonly minVersion?: string;
}

export interface DoctorReport {
  readonly configPath: string;
  readonly projectName: string;
  readonly tools: readonly ToolName[];
  readonly checks: readonly DoctorCheck[];
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
  };
}

interface ProbeResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface DoctorSystem {
  probe(command: string, args?: readonly string[]): ProbeResult;
  runScript(script: string): ProbeResult;
}

type Requirement =
  | {
      readonly kind: "command";
      readonly id: string;
      readonly command: string;
      readonly minVersion?: string;
      readonly installHint?: string;
    }
  | {
      readonly kind: "script";
      readonly id: string;
      readonly script: string;
      readonly installHint?: string;
    };

function withOptionalString<T extends object>(base: T, key: string, value: string | undefined): T {
  if (!value) {
    return base;
  }

  return { ...base, [key]: value };
}

function toCommandRequirement(
  id: string,
  command: string,
  minVersion?: string,
  installHint?: string
): Extract<Requirement, { kind: "command" }> {
  return withOptionalString(
    withOptionalString(
      {
        kind: "command",
        id,
        command
      },
      "minVersion",
      minVersion
    ),
    "installHint",
    installHint
  ) as Extract<Requirement, { kind: "command" }>;
}

function toScriptRequirement(id: string, script: string, installHint?: string): Extract<Requirement, { kind: "script" }> {
  return withOptionalString(
    {
      kind: "script",
      id,
      script
    },
    "installHint",
    installHint
  ) as Extract<Requirement, { kind: "script" }>;
}

function toDoctorCheck(
  base: Omit<DoctorCheck, "installHint" | "detectedVersion" | "minVersion">,
  installHint?: string,
  detectedVersion?: string,
  minVersion?: string
): DoctorCheck {
  return withOptionalString(
    withOptionalString(
      withOptionalString(base, "installHint", installHint),
      "detectedVersion",
      detectedVersion
    ),
    "minVersion",
    minVersion
  ) as DoctorCheck;
}

const VERSION_ARGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  claude: ["--version"],
  codex: ["--version"],
  git: ["--version"],
  node: ["--version"],
  npm: ["--version"],
  pnpm: ["--version"],
  sqlite3: ["--version"]
});

const TOOL_REQUIREMENTS: Readonly<Record<ToolName, Requirement>> = Object.freeze({
  "claude-code": {
    kind: "command",
    id: "claude",
    command: "claude",
    installHint: "npm i -g @anthropic-ai/claude-code"
  },
  codex: {
    kind: "command",
    id: "codex",
    command: "codex",
    installHint: "npm install -g @openai/codex"
  },
  cursor: {
    kind: "command",
    id: "cursor",
    command: "cursor",
    installHint: "Install Cursor from https://cursor.com/downloads"
  },
  aider: {
    kind: "command",
    id: "aider",
    command: "aider",
    installHint: "python -m pip install aider-chat"
  },
  "gemini-cli": {
    kind: "command",
    id: "gemini",
    command: "gemini",
    installHint: "npm install -g @google/gemini-cli"
  }
});

const defaultDoctorSystem: DoctorSystem = {
  probe(command: string, args: readonly string[] = []): ProbeResult {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      shell: false
    });

    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    };
  },
  runScript(script: string): ProbeResult {
    const result = spawnSync(script, {
      encoding: "utf8",
      shell: true
    });

    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    };
  }
};

function normalizeVersion(rawValue: string): string | null {
  const match = rawValue.match(/\d+(?:\.\d+){0,2}/);
  return match?.[0] ?? null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function createRequirements(config: HarnessConfig): Requirement[] {
  const requirements = config.env.required.map<Requirement>((entry) => {
    if ("cmd" in entry) {
      return toCommandRequirement(entry.cmd, entry.cmd, entry.min, entry.install);
    }

    return toScriptRequirement(entry.name ?? entry.script, entry.script, entry.install);
  });

  for (const tool of config.tools) {
    requirements.push(TOOL_REQUIREMENTS[tool]);
  }

  const deduped = new Map<string, Requirement>();
  for (const requirement of requirements) {
    deduped.set(requirement.id, requirement);
  }

  return [...deduped.values()];
}

function evaluateCommandRequirement(requirement: Extract<Requirement, { kind: "command" }>, system: DoctorSystem): DoctorCheck {
  const probe = system.probe(requirement.command, VERSION_ARGS[requirement.command] ?? ["--version"]);

  if (probe.exitCode !== 0) {
    return toDoctorCheck(
      {
        id: requirement.id,
        kind: "command",
        status: "fail",
        message: `${requirement.command} is missing`
      },
      requirement.installHint
    );
  }

  const detectedVersion = normalizeVersion(probe.output);
  if (requirement.minVersion && (!detectedVersion || compareVersions(detectedVersion, requirement.minVersion) < 0)) {
    return toDoctorCheck(
      {
        id: requirement.id,
        kind: "command",
        status: "fail",
        message: `${requirement.command} ${detectedVersion ?? "unknown"} is below ${requirement.minVersion}`
      },
      requirement.installHint,
      detectedVersion ?? undefined,
      requirement.minVersion
    );
  }

  return toDoctorCheck(
    {
      id: requirement.id,
      kind: "command",
      status: "pass",
      message: detectedVersion ? `${requirement.command} ${detectedVersion} available` : `${requirement.command} available`
    },
    undefined,
    detectedVersion ?? undefined,
    requirement.minVersion
  );
}

function evaluateScriptRequirement(requirement: Extract<Requirement, { kind: "script" }>, system: DoctorSystem): DoctorCheck {
  const probe = system.runScript(requirement.script);

  if (probe.exitCode !== 0) {
    return toDoctorCheck(
      {
        id: requirement.id,
        kind: "script",
        status: "fail",
        message: `script check failed: ${requirement.script}`
      },
      requirement.installHint
    );
  }

  return {
    id: requirement.id,
    kind: "script",
    status: "pass",
    message: `script check passed: ${requirement.script}`
  };
}

export async function runDoctor(
  cwd: string,
  options: { readonly configPath?: string; readonly system?: DoctorSystem } = {}
): Promise<DoctorReport> {
  const loadedConfig = await loadHarnessConfig(cwd, options.configPath);
  const system = options.system ?? defaultDoctorSystem;
  const checks = createRequirements(loadedConfig.config).map((requirement) =>
    requirement.kind === "command" ? evaluateCommandRequirement(requirement, system) : evaluateScriptRequirement(requirement, system)
  );

  return {
    configPath: loadedConfig.path,
    projectName: loadedConfig.config.name,
    tools: loadedConfig.config.tools,
    checks,
    summary: {
      pass: checks.filter((check) => check.status === "pass").length,
      fail: checks.filter((check) => check.status === "fail").length
    }
  };
}
