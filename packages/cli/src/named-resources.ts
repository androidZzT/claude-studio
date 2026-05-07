import { HarnessError } from "@harness/core";

export interface NamedResource {
  readonly id: string;
  readonly path?: string | undefined;
  readonly platform?: string | undefined;
  readonly subpath?: string | undefined;
}

export interface LegacyWorkflowResources {
  readonly androidRepo?: string | undefined;
  readonly iosRepo?: string | undefined;
  readonly machproPath?: string | undefined;
  readonly machproRepo?: string | undefined;
  readonly sources: readonly NamedResource[];
  readonly targets: readonly NamedResource[];
}

export interface RenderNamedResourcesYamlOptions {
  readonly commits?: ReadonlyMap<string, string>;
  readonly includeCommit?: boolean;
  readonly includeUnresolvedSubpath?: boolean;
}

export function parseNamedAssignment(
  raw: string,
  flag: string,
): { id: string; value: string } {
  const separatorIndex = raw.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new HarnessError(
      `Expected ${flag} value in id=value form.`,
      "CLI_INVALID_ARGUMENT",
    );
  }

  const id = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1).trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new HarnessError(
      `Invalid resource id "${id}" for ${flag}. Use letters, numbers, "_" or "-".`,
      "CLI_INVALID_ARGUMENT",
    );
  }

  if (!value) {
    throw new HarnessError(
      `Missing value for ${flag} resource "${id}".`,
      "CLI_INVALID_ARGUMENT",
    );
  }

  return { id, value };
}

export function upsertNamedResource(
  resources: readonly NamedResource[],
  id: string,
  patch: Omit<Partial<NamedResource>, "id">,
): readonly NamedResource[] {
  let found = false;
  const next = resources.map((resource) => {
    if (resource.id !== id) {
      return resource;
    }
    found = true;
    return compactResource({ ...resource, ...patch, id });
  });

  if (found) {
    return next;
  }

  return [...next, compactResource({ ...patch, id })];
}

export function mergeDefaultNamedResource(
  resources: readonly NamedResource[],
  fallback: NamedResource,
): readonly NamedResource[] {
  if (!fallback.path && !fallback.platform && !fallback.subpath) {
    return resources;
  }

  const existing = resources.find((resource) => resource.id === fallback.id);
  if (!existing) {
    return [...resources, compactResource(fallback)];
  }

  return resources.map((resource) =>
    resource.id === fallback.id
      ? compactResource({
          ...resource,
          path: resource.path ?? fallback.path,
          platform: resource.platform ?? fallback.platform,
          subpath: resource.subpath ?? fallback.subpath,
        })
      : resource,
  );
}

export function withDefaultPlatform(
  resources: readonly NamedResource[],
): readonly NamedResource[] {
  return resources.map((resource) =>
    compactResource({
      ...resource,
      platform: resource.platform ?? resource.id,
    }),
  );
}

export function preferredResource(
  resources: readonly NamedResource[],
  preferredId: string,
): NamedResource | undefined {
  return (
    resources.find((resource) => resource.id === preferredId) ?? resources[0]
  );
}

export function resolveWorkflowSources(
  args: LegacyWorkflowResources,
): readonly NamedResource[] {
  return mergeDefaultNamedResource(args.sources, {
    id: "machpro",
    path: args.machproRepo,
    platform: args.machproRepo || args.machproPath ? "machpro" : undefined,
    subpath: args.machproPath,
  });
}

export function resolveWorkflowTargets(
  args: LegacyWorkflowResources,
): readonly NamedResource[] {
  const withAndroid = mergeDefaultNamedResource(args.targets, {
    id: "android",
    path: args.androidRepo,
    platform: args.androidRepo ? "android" : undefined,
  });
  const withIos = mergeDefaultNamedResource(withAndroid, {
    id: "ios",
    path: args.iosRepo,
    platform: args.iosRepo ? "ios" : undefined,
  });
  return withDefaultPlatform(withIos);
}

export function renderResourcesForPrompt(
  resources: readonly NamedResource[],
  emptyLabel = "未提供",
): string {
  if (resources.length === 0) {
    return `  - ${emptyLabel}`;
  }

  return resources
    .map((resource) => {
      const parts = [
        `path=${resource.path ?? "未提供"}`,
        `subpath=${resource.subpath ?? "未提供"}`,
        `platform=${resource.platform ?? resource.id}`,
      ];
      return `  - ${resource.id}: ${parts.join(", ")}`;
    })
    .join("\n");
}

export function renderNamedResourcesYaml(
  resources: readonly NamedResource[],
  indent: number,
  options: RenderNamedResourcesYamlOptions = {},
): string {
  if (resources.length === 0) {
    return `${" ".repeat(indent)}{}`;
  }

  return resources
    .map((resource) => {
      const padding = " ".repeat(indent);
      const childPadding = " ".repeat(indent + 2);
      const lines = [
        `${padding}${resource.id}:`,
        `${childPadding}path: ${yamlScalar(resource.path ?? "unresolved")}`,
        `${childPadding}platform: ${yamlScalar(resource.platform ?? resource.id)}`,
      ];

      if (resource.subpath || options.includeUnresolvedSubpath) {
        lines.push(
          `${childPadding}subpath: ${yamlScalar(resource.subpath ?? "unresolved")}`,
        );
      }

      if (options.includeCommit) {
        lines.push(
          `${childPadding}commit: ${yamlScalar(options.commits?.get(resource.id) ?? "unresolved")}`,
        );
      }

      return lines.join("\n");
    })
    .join("\n");
}

export function renderLegacyMachproYaml(
  source: NamedResource | undefined,
  commit: string | undefined,
): string {
  if (!source) {
    return "\n";
  }

  return `
machpro:
  source_repo: ${yamlScalar(source.path ?? "unresolved")}
  source_path: ${yamlScalar(source.subpath ?? "unresolved")}
  commit: ${yamlScalar(commit ?? "unresolved")}

`;
}

export function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./:@~+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function compactResource(resource: NamedResource): NamedResource {
  return {
    id: resource.id,
    ...(resource.path ? { path: resource.path } : {}),
    ...(resource.platform ? { platform: resource.platform } : {}),
    ...(resource.subpath ? { subpath: resource.subpath } : {}),
  };
}
