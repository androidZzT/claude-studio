export type PlannedContent = string | Uint8Array;

export interface FullPlannedFile {
  readonly rootDir: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly kind?: "full";
  readonly content: PlannedContent;
  readonly mode: number;
}

export interface PartialPlannedFile {
  readonly rootDir: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly kind: "partial-json";
  readonly ownedKeys: readonly string[];
  readonly ownedValues: Readonly<Record<string, unknown>>;
  readonly mode: number;
}

export type PlannedFile = FullPlannedFile | PartialPlannedFile;
