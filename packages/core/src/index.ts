export {
  BOOTSTRAP_STAGE,
  CLAUDE_MD_OUTPUT_PATH,
  CLAUDE_REFERENCE_PROJECTS_OUTPUT_PATH,
  CLAUDE_SETTINGS_OUTPUT_PATH,
  CODEX_AGENTS_OUTPUT_PATH,
  CODEX_CONFIG_OUTPUT_PATH,
  CURSOR_MCP_OUTPUT_PATH,
  DEFAULT_CONFIG_FILE,
  DEFAULT_CODEX_CONFIG_TEMPLATE_PATH,
  DEFAULT_EVAL_LOGS_PATH,
  DEFAULT_INSTRUCTIONS_TEMPLATE_PATH,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_NEXT_COMMAND,
  DEFAULT_PROJECT_NAME,
  EVAL_LOG_EXTENSION,
  EVAL_LOG_STATUS_SUCCESS,
  EVAL_LOG_TASK_NAME,
  EVAL_LOG_VERSION,
  GENERATED_AGENTS_HEADER,
  GENERATED_HOOK_HEADER,
  LOG_LEVELS,
  MANIFEST_SCHEMA_VERSION,
  MCP_NO_RENDERER_WARNING,
  PLUGINS_NO_RENDERER_WARNING,
  REFERENCE_PROJECTS_NO_RENDERER_WARNING,
  DEFAULT_CLAUDE_AGENTS_SOURCE_PATH,
  DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH,
  DEFAULT_CLAUDE_DOCS_SOURCE_PATH,
  DEFAULT_CLAUDE_METRICS_SOURCE_PATH,
  DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH,
  DEFAULT_CLAUDE_RULES_SOURCE_PATH,
  DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH,
  DEFAULT_CLAUDE_SKILLS_SOURCE_PATH,
  PRE_COMMIT_HOOK_PATH,
} from "./constants.js";
export { adoptFromSource } from "./adopt/adopt.js";
export { buildAdoptGitignore } from "./adopt/gitignore-builder.js";
export { buildHarnessYaml } from "./adopt/harness-yaml-builder.js";
export type { AdoptOptions, AdoptResult } from "./adopt/types.js";
export {
  harnessConfigSchema,
  loadHarnessConfig,
  parseHarnessConfig,
  LOCAL_CONFIG_FILE,
  HOOK_NAMES,
  HOOK_SHELLS,
  CLAUDE_LIFECYCLE_HOOK_NAMES,
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_MATCHER_HOOK_NAMES,
  CLAUDE_NON_MATCHER_HOOK_NAMES,
  claudeCodeCapabilitySchema,
  contextVisibilityModeSchema,
  claudeLifecycleHookNameSchema,
  hookNameSchema,
  hookShellSchema,
  TOOL_NAMES,
  CONTEXT_VISIBILITY_MODES,
  toolNameSchema,
} from "./harness-config.js";
export type {
  AgentToolsConfig,
  ClaudeCodeAdapterConfig,
  ClaudeCodeCapability,
  ClaudeLifecycleHookName,
  ClaudeMatcherHookName,
  ClaudeNonMatcherHookName,
  CodexAdapterConfig,
  CommandRequirement,
  ContextVisibilityMode,
  ContextVisibilityRule,
  HarnessConfig,
  HookDefinition,
  HookName,
  HookShell,
  LifecycleHookDefinition,
  LoadedHarnessConfig,
  LoadHarnessConfigOptions,
  HarnessConfigParseOptions,
  McpConfig,
  ModelProfile,
  ReferenceProjectsConfig,
  ScriptRequirement,
  ToolName,
  ToolModelsConfig,
} from "./harness-config.js";
export type { CursorAdapterConfig } from "./harness-config.js";
export {
  ADAPTER_FEATURES,
  ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
  adapterCapabilitiesEntrySchema,
  adaptersCapabilitiesReportSchema,
  describeAdapterCapabilities,
} from "./adapters/capabilities.js";
export type {
  AdapterCapabilitiesEntry,
  AdaptersCapabilitiesReport,
} from "./adapters/capabilities.js";
export { createClaudeCodeAdapter } from "./adapters/claude-code.js";
export {
  createCodexAdapter,
  renderCodexProfilesFragment,
} from "./adapters/codex.js";
export { createCursorAdapter } from "./adapters/cursor.js";
export { planClaudeScriptsDirectory } from "./adapters/claude-scripts.js";
export {
  adapterListEntrySchema,
  adaptersListReportSchema,
  describeConfiguredAdapters,
} from "./adapters/list.js";
export type { AdapterListEntry, AdaptersListReport } from "./adapters/list.js";
export {
  findRegisteredAdapter,
  getAdapter,
  getConfiguredAdapters,
  listRegisteredAdapters,
} from "./adapters/registry.js";
export type {
  Adapter,
  AdapterCapabilities,
  AdapterPlanOptions,
} from "./adapters/types.js";
export { runDoctor } from "./doctor.js";
export type {
  DoctorCheck,
  DoctorReport,
  DoctorStatus,
  DoctorSystem,
} from "./doctor.js";
export { HarnessError } from "./errors.js";
export {
  commonEventKindSchema,
  commonEventModelSchema,
  commonEventSchema,
  commonEventSourceSchema,
  commonEventThinkingSchema,
  commonEventToolSchema,
  tokenUsageSchema,
} from "./eval/common-event.js";
export type {
  CommonEvent,
  CommonEventKind,
  CommonEventModel,
  CommonEventSource,
  CommonEventThinking,
  CommonEventTool,
  TokenUsage,
} from "./eval/common-event.js";
export {
  evalLogSchema,
  validateEvalLog,
  writeEvalLog,
} from "./eval/evallog-writer.js";
export type { EvalLog, EvalLogMeta } from "./eval/evallog-writer.js";
export {
  findEvalLogByRunId,
  ingestTrajectory,
  listEvalLogs,
  parseTrajectoryEvents,
} from "./eval/ingest.js";
export type {
  EvalLogFileMatch,
  EvalLogListEntry,
  IngestTrajectoryOptions,
  IngestTrajectoryResult,
} from "./eval/ingest.js";
export { ingestRunTrajectory } from "./eval/ingest-run.js";
export type {
  IngestRunTrajectoryOptions,
  IngestRunTrajectoryResult,
} from "./eval/ingest-run.js";
export { compareEvalRuns, runEvalScenario } from "./eval/scenario.js";
export type {
  EvalCompareMetrics,
  EvalCompareResult,
  EvalScenario,
  EvalScenarioRunOptions,
  EvalScenarioRunResult,
} from "./eval/scenario.js";
export {
  ClaudeCodeParser,
  createClaudeCodeParser,
  inferClaudeCodeSessionId,
} from "./eval/parsers/claude-code.js";
export {
  CodexParser,
  createCodexParser,
  inferCodexSessionId,
} from "./eval/parsers/codex.js";
export { scoreFunnel } from "./eval/scorer/funnel.js";
export {
  createFunnelEvalLogScore,
  funnelEvalLogScoreSchema,
  funnelScoreSchema,
  performanceScoreSchema,
  qualityScoreSchema,
} from "./eval/scorer/types.js";
export type {
  AdoptionRateInput,
  BugDensityInput,
  FirstPassRateInput,
  FunnelEvalLogScore,
  FunnelScore,
  PerformanceScore,
  QualityScore,
  QualityScoreInputs,
  ReviewPassEfficiencyInput,
  ScoreFunnelInput,
  SmokePassRateInput,
  TechDesignConformanceInput,
} from "./eval/scorer/types.js";
export {
  createPassThroughAdapter,
  PassThroughAdapter,
} from "./eval/stubs/pass-through.js";
export type {
  ParserContext,
  TrajectoryAdapter,
} from "./eval/trajectory-adapter.js";
export { planHooks } from "./hooks/planner.js";
export { runInit } from "./init.js";
export type { InitOptions, InitResult } from "./init.js";
export { createLogger } from "./logger.js";
export type { LogLevel, Logger } from "./logger.js";
export {
  applyDeterministicGateOverride,
  evaluateDeterministicSignals,
} from "./runtime/deterministic-gates.js";
export type {
  AdvisoryCheckpointDecision,
  DeterministicCheckpointDecision,
  DeterministicGateFail,
  DeterministicGateOptions,
  DeterministicGatePass,
  DeterministicGateResult,
  DeterministicSignals,
} from "./runtime/deterministic-gates.js";
export {
  buildDriftCheckpointPrompt,
  runDriftCheckpoint,
} from "./runtime/drift-checkpoint.js";
export type {
  BuildDriftPromptOptions,
  DriftPhaseOutput,
  RunDriftCheckpointOptions,
} from "./runtime/drift-checkpoint.js";
export { runAutonomousDryRunPreflight } from "./runtime/dry-run-preflight.js";
export type {
  AutonomousDryRunIgnoredPathReport,
  AutonomousDryRunOptions,
  AutonomousDryRunPhaseReport,
  AutonomousDryRunReport,
} from "./runtime/dry-run-preflight.js";
export {
  isPathAllowedByTaskCard,
  loadTaskCard,
  pathPatternMatches,
  readTaskCardFromRunStore,
  taskCardBudgetSchema,
  taskCardSchema,
  writeTaskCardArtifacts,
} from "./runtime/task-card.js";
export type {
  LoadedTaskCard,
  TaskCard,
  TaskCardBudget,
} from "./runtime/task-card.js";
export { runAutonomousExecution } from "./runtime/autonomous-run.js";
export type {
  AutonomousRunCheckpointReport,
  AutonomousRunGateReport,
  AutonomousRunOptions,
  AutonomousRunPhaseReport,
  AutonomousRunReport,
} from "./runtime/autonomous-run.js";
export {
  applyTaskCardTimeout,
  evaluateBudget,
  evaluateRisk,
  renderRiskEscalationQuestion,
} from "./runtime/governance.js";
export type {
  BudgetReport,
  GovernanceFinding,
  RiskReport,
} from "./runtime/governance.js";
export {
  phaseResultArtifactSchema,
  validatePhaseResultArtifact,
} from "./runtime/phase-result.js";
export type {
  PhaseResultArtifact,
  PhaseResultValidationReport,
} from "./runtime/phase-result.js";
export {
  checkpointDecisionSchema,
  defaultCheckpointModel,
  runCheckpoint,
} from "./runtime/checkpoint.js";
export type {
  CheckpointCost,
  CheckpointDecision,
  CheckpointJudge,
  CheckpointJudgeInput,
  CheckpointJudgeOutput,
  PreviousPhaseModelClass,
  RunCheckpointOptions,
  RunCheckpointResult,
} from "./runtime/checkpoint.js";
export {
  loadRunState,
  recoverCorruptedRunState,
  resumeRunFromDecision,
  runStateSchema,
  saveRunState,
  writeEscalationRequest,
} from "./runtime/pause-resume.js";
export type {
  EscalationRequestResult,
  PauseResumeClock,
  RunState,
} from "./runtime/pause-resume.js";
export {
  createProviderCheckpointJudge,
  createProviderPhaseAuditJudge,
  extractJsonObject,
} from "./runtime/provider-judges.js";
export type {
  ProviderJudgeOptions,
  ProviderJudgeSpawn,
  ProviderJudgeTool,
} from "./runtime/provider-judges.js";
export {
  acquireRunLock,
  appendRunEvent,
  getDefaultRunRoot,
  getRunStorePaths,
  initializeRunStore,
  inspectRunLiveness,
  isPathIgnoredByGitignore,
  pathExists as runStorePathExists,
  preflightRunRoot,
  repairInterruptedPhaseArtifacts,
  recomputeEstimatedDollars,
  runEventSchema,
  runLockSchema,
  RUN_EVENT_KINDS,
} from "./runtime/run-store.js";
export type {
  RunEvent,
  RunEventKind,
  RunLiveness,
  RunLivenessReport,
  RunLock,
  RunStorePaths,
  RunStoreProcessInfo,
} from "./runtime/run-store.js";
export {
  auditBlockingPolicySchema,
  phaseAuditJudgeOutputSchema,
  phaseAuditReportSchema,
  phaseAuditSpecSchema,
  runPhaseAudits,
  runPhaseGroupAudit,
} from "./runtime/audit.js";
export type {
  AuditBlockingPolicy,
  Finding,
  PhaseAuditJudge,
  PhaseAuditJudgeInput,
  PhaseAuditJudgeOutput,
  PhaseAuditReport,
  PhaseAuditSpec,
} from "./runtime/audit.js";
export {
  capturePhaseTrajectory,
  normalizeTrajectoryEvents,
  normalizedTrajectoryEventKindSchema,
  phaseTrajectorySummarySchema,
} from "./runtime/trajectory.js";
export type {
  CapturePhaseTrajectoryOptions,
  NormalizedTrajectoryEvent,
  NormalizedTrajectoryEventKind,
  PhaseTrajectorySummary,
} from "./runtime/trajectory.js";
export {
  generateRunVisualization,
  inspectRunStore,
  renderRunHtml,
  renderRunInspectionText,
  renderWorkflowMermaid,
  resolveRunStorePathsForThread,
} from "./runtime/run-report.js";
export type {
  RunInspectionReport,
  RunPhaseInspection,
  RunVisualizationResult,
} from "./runtime/run-report.js";
export {
  createPhasePromptSha256,
  resolveCwdRef,
  runPhase,
  runPhaseGroup,
} from "./runtime/phase-executor.js";
export type {
  PhaseCost,
  PhaseExecutionOptions,
  PhaseExecutionResult,
  PhaseGroupExecutionOptions,
  PhaseSpec,
  PhaseSpawn,
} from "./runtime/phase-executor.js";
export {
  GATE_COMMAND_KINDS,
  runGateCommand,
  validateGateCommand,
} from "./runtime/safe-command-runner.js";
export type {
  GateCommand,
  GateCommandKind,
  GateCommandResult,
  GateCommandRunOptions,
  GateCommandSpawn,
} from "./runtime/safe-command-runner.js";
export {
  getAgentTool,
  getAgentsWithExplicitToolRoute,
  hasResolvedModelProfileFields,
  isAgentRoutedToTool,
  resolveToolModelProfile,
} from "./agent-routing.js";
export type { ResolvedModelProfile } from "./agent-routing.js";
export {
  getSortedMcpServers,
  hasDeclaredMcp,
  hasNonEmptyMcpServers,
  mcpConfigSchema,
  mcpServerNameSchema,
  mcpServerSchema,
  renderCodexMcpFragment,
  renderCursorMcpDocument,
} from "./mcp.js";
export type { McpServer } from "./mcp.js";
export {
  findUndeclaredPluginMarketplaceReferences,
  hasDeclaredPlugins,
  hasNonEmptyPlugins,
  pluginSettingsFormatSchema,
  pluginMarketplaceSchema,
  pluginReferenceSchema,
  pluginsConfigSchema,
  pluginScopeSchema,
  renderClaudeEnabledPlugins,
  renderClaudeEnabledPluginsArray,
  renderClaudeEnabledPluginsObject,
  renderClaudePluginMarketplaces,
} from "./plugins.js";
export type {
  EnabledPlugin,
  PluginMarketplace,
  PluginsConfig,
  PluginScope,
  PluginSettingsFormat,
} from "./plugins.js";
export {
  hasDeclaredReferenceProjects,
  referenceProjectEntrySchema,
  referenceProjectsConfigSchema,
  renderReferenceProjectsDocument,
} from "./reference-projects.js";
export type { ReferenceProjectEntry } from "./reference-projects.js";
export { createWorkspaceSummary } from "./project.js";
export type { WorkspaceSummary } from "./project.js";
export {
  createManifestFromPlan,
  getManifestPath,
  loadManifest,
  manifestSchema,
  saveManifest,
} from "./reconciler/manifest.js";
export type { ManifestEntry, ManifestFile } from "./reconciler/manifest.js";
export {
  existingOwnedKeys,
  hashOwnedValues,
  mergeWrite,
  readJsonObjectIfExists,
  readPartial,
  removePartial,
} from "./reconciler/partial-json.js";
export { reconcile } from "./reconciler/index.js";
export type {
  ReconcileEntry,
  ReconcileOptions,
  ReconcileResult,
} from "./reconciler/index.js";
export { buildPlanForWorkspace, runDiff, runSync } from "./sync.js";
export type {
  FullPlannedFile,
  PartialPlannedFile,
  PlannedContent,
  PlannedFile,
} from "./sync-types.js";
