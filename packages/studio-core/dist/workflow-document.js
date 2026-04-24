"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWorkflowDocument = parseWorkflowDocument;
exports.formatWorkflowDocument = formatWorkflowDocument;
const js_yaml_1 = __importDefault(require("js-yaml"));
const topology_1 = require("./topology");
const YAML_BLOCK_RE = /```(?:yaml|yml)\s*\n([\s\S]*?)```/gi;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function asWorkflowRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const nodesRaw = record.nodes;
    if (!Array.isArray(nodesRaw)) {
        return null;
    }
    const nodes = [];
    for (const nodeRaw of nodesRaw) {
        if (!nodeRaw || typeof nodeRaw !== 'object' || Array.isArray(nodeRaw)) {
            return null;
        }
        const node = nodeRaw;
        if (typeof node.id !== 'string' || typeof node.agent !== 'string' || typeof node.task !== 'string') {
            return null;
        }
        nodes.push({
            id: node.id,
            agent: node.agent,
            task: node.task,
            depends_on: isStringArray(node.depends_on) ? node.depends_on : undefined,
            roundtrip: isStringArray(node.roundtrip) ? node.roundtrip : undefined,
            checkpoint: typeof node.checkpoint === 'boolean' ? node.checkpoint : undefined,
            skills: isStringArray(node.skills) ? node.skills : undefined,
            mcp_servers: isStringArray(node.mcp_servers) ? node.mcp_servers : undefined,
        });
    }
    return {
        name: typeof record.name === 'string' ? record.name : undefined,
        description: typeof record.description === 'string' ? record.description : undefined,
        version: typeof record.version === 'number' ? record.version : undefined,
        nodes,
    };
}
function parseYamlCandidate(content) {
    try {
        const parsed = js_yaml_1.default.load(content);
        return asWorkflowRecord(parsed);
    }
    catch {
        return null;
    }
}
function buildWorkflowYaml(workflow) {
    const doc = {
        name: workflow.name ?? 'unnamed-workflow',
        description: workflow.description ?? '',
        version: workflow.version ?? 1,
        nodes: workflow.nodes.map((node) => {
            const out = {
                id: node.id,
                agent: node.agent,
                task: node.task,
            };
            if (node.depends_on && node.depends_on.length > 0)
                out.depends_on = [...node.depends_on];
            if (node.roundtrip && node.roundtrip.length > 0)
                out.roundtrip = [...node.roundtrip];
            if (node.checkpoint)
                out.checkpoint = true;
            if (node.skills && node.skills.length > 0)
                out.skills = [...node.skills];
            if (node.mcp_servers && node.mcp_servers.length > 0)
                out.mcp_servers = [...node.mcp_servers];
            return out;
        }),
    };
    return js_yaml_1.default.dump(doc, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
    }).trimEnd();
}
function computePhases(workflow) {
    const nodesById = new Map();
    for (const node of workflow.nodes) {
        nodesById.set(node.id, node);
    }
    const nodeIds = new Set(workflow.nodes.map((node) => node.id));
    const depsMap = new Map();
    for (const node of workflow.nodes) {
        const deps = [
            ...(node.depends_on ?? []),
            ...(node.roundtrip ?? []),
        ].filter((dep) => nodeIds.has(dep));
        depsMap.set(node.id, deps);
    }
    const levels = (0, topology_1.computeLevelsFromDepsMap)(nodeIds, depsMap);
    return levels.map((levelIds) => levelIds
        .map((id) => nodesById.get(id))
        .filter((node) => Boolean(node)));
}
function formatList(items) {
    return items && items.length > 0 ? items.map((item) => `\`${item}\``).join(', ') : 'None';
}
function parseWorkflowDocument(content) {
    const direct = parseYamlCandidate(content);
    if (direct) {
        return direct;
    }
    // Reset shared regex state before each parse attempt. Without this, repeated
    // calls can produce alternating pass/fail results due to stale lastIndex.
    YAML_BLOCK_RE.lastIndex = 0;
    let yamlBlockMatch;
    while ((yamlBlockMatch = YAML_BLOCK_RE.exec(content)) !== null) {
        const fromBlock = parseYamlCandidate(yamlBlockMatch[1]);
        if (fromBlock) {
            YAML_BLOCK_RE.lastIndex = 0;
            return fromBlock;
        }
    }
    YAML_BLOCK_RE.lastIndex = 0;
    const fmMatch = content.match(FRONTMATTER_RE);
    if (fmMatch) {
        const fromFrontmatter = parseYamlCandidate(fmMatch[1]);
        if (fromFrontmatter) {
            return fromFrontmatter;
        }
    }
    return null;
}
function formatWorkflowDocument(input) {
    const workflow = typeof input === 'string'
        ? parseWorkflowDocument(input)
        : asWorkflowRecord(input);
    if (!workflow) {
        if (typeof input === 'string') {
            return input;
        }
        throw new Error('Invalid workflow object for formatting');
    }
    const workflowName = workflow.name ?? 'unnamed-workflow';
    const workflowDescription = workflow.description ?? '';
    const phases = computePhases(workflow);
    const canonicalYaml = buildWorkflowYaml(workflow);
    const lines = [];
    lines.push(`# Workflow: ${workflowName}`);
    lines.push('');
    if (workflowDescription.trim()) {
        lines.push(workflowDescription.trim());
        lines.push('');
    }
    lines.push('## Execution Plan');
    lines.push('');
    lines.push(`- Total phases: ${phases.length}`);
    lines.push(`- Total nodes: ${workflow.nodes.length}`);
    lines.push('- Parallel nodes are grouped in the same phase.');
    lines.push('');
    phases.forEach((phaseNodes, index) => {
        const phaseTitle = phaseNodes.length === 1
            ? phaseNodes[0].id
            : `${phaseNodes.length} parallel nodes`;
        lines.push(`## Phase ${index + 1}: ${phaseTitle}`);
        lines.push('');
        for (const node of phaseNodes) {
            lines.push(`- **Node**: \`${node.id}\``);
            lines.push(`  - Agent: \`${node.agent}\``);
            lines.push(`  - Task: ${node.task}`);
            lines.push(`  - Depends On: ${formatList(node.depends_on)}`);
            lines.push(`  - Checkpoint: ${node.checkpoint ? 'Yes' : 'No'}`);
            lines.push(`  - Skills: ${formatList(node.skills)}`);
            lines.push(`  - MCP Servers: ${formatList(node.mcp_servers)}`);
        }
        lines.push('');
    });
    lines.push('## Canonical Workflow YAML');
    lines.push('');
    lines.push('```yaml');
    lines.push(canonicalYaml);
    lines.push('```');
    lines.push('');
    return lines.join('\n');
}
//# sourceMappingURL=workflow-document.js.map