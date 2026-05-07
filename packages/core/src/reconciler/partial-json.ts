import { HarnessError } from "../errors.js";

import { atomicWriteText, readTextIfExists, removeFileIfExists, sha256 } from "./file-ops.js";

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(source: string, filePath: string): JsonObject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new HarnessError(
      `Expected ${filePath} to contain a JSON object for partial ownership merge.`,
      "PARTIAL_JSON_INVALID"
    );
  }

  if (!isPlainObject(parsed)) {
    throw new HarnessError(`Expected ${filePath} to contain a top-level JSON object.`, "PARTIAL_JSON_INVALID");
  }

  return parsed;
}

function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeysDeep(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortObjectKeysDeep(value[key])])
  );
}

function serializeJsonDocument(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function pickOwnedSubset(document: JsonObject, ownedKeys: readonly string[]): JsonObject {
  return Object.fromEntries(ownedKeys.filter((key) => key in document).map((key) => [key, document[key]]));
}

function withoutOwnedKeys(document: JsonObject, ownedKeys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(document).filter(([key]) => !ownedKeys.includes(key)));
}

export function hashOwnedValues(ownedValues: Readonly<Record<string, unknown>>): string {
  return sha256(JSON.stringify(sortObjectKeysDeep(ownedValues)));
}

export async function readPartial(filePath: string, ownedKeys: readonly string[]): Promise<JsonObject> {
  const source = await readTextIfExists(filePath);
  if (!source) {
    return {};
  }

  return pickOwnedSubset(parseJsonObject(source, filePath), ownedKeys);
}

export async function readJsonObjectIfExists(filePath: string): Promise<JsonObject | undefined> {
  const source = await readTextIfExists(filePath);
  if (!source) {
    return undefined;
  }

  return parseJsonObject(source, filePath);
}

export async function mergeWrite(
  filePath: string,
  ownedKeys: readonly string[],
  ownedValues: Readonly<Record<string, unknown>>,
  mode: number
): Promise<void> {
  const existingDocument = (await readJsonObjectIfExists(filePath)) ?? {};
  const preservedUserEntries = Object.entries(existingDocument).filter(([key]) => !ownedKeys.includes(key));
  const harnessEntries = [...new Set(ownedKeys)]
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => key in ownedValues)
    .map((key) => [key, ownedValues[key]] as const);
  const mergedDocument = Object.fromEntries([...preservedUserEntries, ...harnessEntries]);

  await atomicWriteText(filePath, serializeJsonDocument(mergedDocument), mode);
}

export async function removePartial(filePath: string, ownedKeys: readonly string[], mode: number): Promise<void> {
  const existingDocument = await readJsonObjectIfExists(filePath);
  if (!existingDocument) {
    return;
  }

  const preservedDocument = withoutOwnedKeys(existingDocument, ownedKeys);
  if (Object.keys(preservedDocument).length === 0) {
    await removeFileIfExists(filePath);
    return;
  }

  await atomicWriteText(filePath, serializeJsonDocument(preservedDocument), mode);
}

export async function existingOwnedKeys(filePath: string, ownedKeys: readonly string[]): Promise<string[]> {
  const document = await readJsonObjectIfExists(filePath);
  if (!document) {
    return [];
  }

  return ownedKeys.filter((key) => key in document);
}
