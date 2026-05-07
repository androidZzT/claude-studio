import { z } from "zod";

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

const nonEmptyStringSchema = z.string().trim().min(1);
const isoTimestampSchema = nonEmptyStringSchema.refine(isIsoTimestamp, "Expected an ISO 8601 timestamp.");

export const commonEventSourceSchema = z.enum(["claude-code", "codex", "stub"]);
export const commonEventKindSchema = z.enum([
  "model",
  "tool_call",
  "tool_result",
  "user_input",
  "session_meta",
  "lifecycle",
  "error"
]);

export const tokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional()
  })
  .strict();

export const commonEventModelSchema = z
  .object({
    id: nonEmptyStringSchema,
    provider: nonEmptyStringSchema,
    usage: tokenUsageSchema.optional()
  })
  .strict();

export const commonEventToolSchema = z
  .object({
    name: nonEmptyStringSchema,
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional()
  })
  .strict();

export const commonEventThinkingSchema = z
  .object({
    content: z.string(),
    signature: z.string().optional()
  })
  .strict();

export const commonEventSchema = z
  .object({
    source: commonEventSourceSchema,
    session_id: nonEmptyStringSchema,
    event_id: nonEmptyStringSchema,
    timestamp: isoTimestampSchema,
    cwd: nonEmptyStringSchema.optional(),
    kind: commonEventKindSchema,
    model: commonEventModelSchema.optional(),
    tool: commonEventToolSchema.optional(),
    text: z.string().optional(),
    thinking: commonEventThinkingSchema.optional(),
    parent_event_id: nonEmptyStringSchema.optional(),
    subagent_id: nonEmptyStringSchema.optional(),
    turn_id: nonEmptyStringSchema.optional(),
    raw: z.unknown()
  })
  .strict();

export type CommonEventSource = z.infer<typeof commonEventSourceSchema>;
export type CommonEventKind = z.infer<typeof commonEventKindSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type CommonEventModel = z.infer<typeof commonEventModelSchema>;
export type CommonEventTool = z.infer<typeof commonEventToolSchema>;
export type CommonEventThinking = z.infer<typeof commonEventThinkingSchema>;
export type CommonEvent = z.infer<typeof commonEventSchema>;
