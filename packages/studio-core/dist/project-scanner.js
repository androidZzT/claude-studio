"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanProjectAtPath = scanProjectAtPath;
exports.scanAllProjectSummaries = scanAllProjectSummaries;
exports.scanAllProjects = scanAllProjects;
exports.scanProjectById = scanProjectById;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const claude_home_1 = require("./claude-home");
const file_ops_1 = require("./file-ops");
const workflow_document_1 = require("./workflow-document");
const CLAUDE_PROJECTS_META_DIR = node_path_1.default.join(node_os_1.default.homedir(), '.claude', 'projects');
/**
 * Known parent directories where Claude Code projects live.
 * We scan these for subdirectories containing CLAUDE.md instead of
 * trying to reverse-engineer the encoded directory names.
 * Override with CC_STUDIO_SEARCH_DIRS env var (colon-separated paths).
 */
const SEARCH_DIRS = process.env.CC_STUDIO_SEARCH_DIRS
    ? process.env.CC_STUDIO_SEARCH_DIRS.split(':').map((d) => d.trim()).filter(Boolean)
    : [
        node_path_1.default.join(node_os_1.default.homedir(), 'Claude'),
        node_path_1.default.join(node_os_1.default.homedir(), 'Github'),
        node_path_1.default.join(node_os_1.default.homedir(), 'Workspace'),
    ];
async function readAgentFile(filePath) {
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        const name = node_path_1.default.basename(filePath, '.md');
        const id = encodeURIComponent(name);
        const { data, content: body } = (0, gray_matter_1.default)(content);
        return {
            id,
            type: 'agents',
            name,
            path: filePath,
            content: body,
            frontmatter: Object.keys(data).length > 0 ? data : undefined,
        };
    }
    catch {
        return null;
    }
}
async function readWorkflowFile(filePath) {
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        const name = node_path_1.default.basename(filePath, node_path_1.default.extname(filePath));
        const id = encodeURIComponent(name);
        const parsed = (0, workflow_document_1.parseWorkflowDocument)(content);
        if (!parsed) {
            return { id, type: 'workflows', name, path: filePath, content };
        }
        return {
            id,
            type: 'workflows',
            name,
            path: filePath,
            content,
            frontmatter: parsed,
        };
    }
    catch {
        return null;
    }
}
async function listAgents(dir) {
    if (!(await (0, file_ops_1.fileExists)(dir)))
        return [];
    try {
        const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
        const results = await Promise.all(files.map((e) => readAgentFile(node_path_1.default.join(dir, e.name))));
        return results.filter((r) => r !== null);
    }
    catch {
        return [];
    }
}
async function listSkills(dir) {
    if (!(await (0, file_ops_1.fileExists)(dir)))
        return [];
    try {
        const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory());
        const results = await Promise.all(dirs.map(async (d) => {
            const skillFile = node_path_1.default.join(dir, d.name, 'SKILL.md');
            if (!(await (0, file_ops_1.fileExists)(skillFile)))
                return null;
            try {
                const content = await promises_1.default.readFile(skillFile, 'utf-8');
                const { data, content: body } = (0, gray_matter_1.default)(content);
                return {
                    id: encodeURIComponent(d.name),
                    type: 'skills',
                    name: d.name,
                    path: skillFile,
                    content: body,
                    frontmatter: Object.keys(data).length > 0 ? data : undefined,
                };
            }
            catch {
                return null;
            }
        }));
        return results.filter((r) => r !== null);
    }
    catch {
        return [];
    }
}
async function listWorkflows(dir) {
    if (!(await (0, file_ops_1.fileExists)(dir)))
        return [];
    try {
        const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.yaml') || e.name.endsWith('.yml')));
        const results = await Promise.all(files.map((e) => readWorkflowFile(node_path_1.default.join(dir, e.name))));
        return results.filter((r) => r !== null);
    }
    catch {
        return [];
    }
}
async function listMemories(memoryDir) {
    if (!(await (0, file_ops_1.fileExists)(memoryDir)))
        return [];
    try {
        const entries = await promises_1.default.readdir(memoryDir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
        const results = await Promise.all(files.map((e) => readMemoryFile(node_path_1.default.join(memoryDir, e.name))));
        return results.filter((r) => r !== null);
    }
    catch {
        return [];
    }
}
async function readMemoryFile(filePath) {
    try {
        const [content, stat] = await Promise.all([
            promises_1.default.readFile(filePath, 'utf-8'),
            promises_1.default.stat(filePath),
        ]);
        const fileName = node_path_1.default.basename(filePath, '.md');
        const id = `memory:${encodeURIComponent(fileName)}`;
        const { data, content: body } = (0, gray_matter_1.default)(content);
        const displayName = typeof data.name === 'string' ? data.name : fileName;
        return {
            id,
            type: 'memories',
            name: displayName,
            path: filePath,
            content: body,
            frontmatter: Object.keys(data).length > 0 ? data : undefined,
            modifiedAt: stat.mtime.toISOString(),
        };
    }
    catch {
        return null;
    }
}
async function readClaudeMd(projectPath) {
    const claudeMdPath = node_path_1.default.join(projectPath, 'CLAUDE.md');
    try {
        return await promises_1.default.readFile(claudeMdPath, 'utf-8');
    }
    catch {
        return undefined;
    }
}
async function scanGlobalProject() {
    const claudeHome = (0, claude_home_1.getClaudeHome)();
    const [agents, workflows, skills] = await Promise.all([
        listAgents(node_path_1.default.join(claudeHome, 'agents')),
        listWorkflows(node_path_1.default.join(claudeHome, 'workflows')),
        listSkills(node_path_1.default.join(claudeHome, 'skills')),
    ]);
    return {
        id: 'global',
        name: 'Global',
        path: claudeHome,
        agents,
        workflows,
        skills,
        memories: [],
    };
}
/**
 * Build a lookup from encoded directory names to real filesystem paths.
 *
 * Instead of the previous greedy decode algorithm (which tried all possible
 * path segment combinations with fs.stat calls), we simply scan known parent
 * directories for subdirectories and build a reverse mapping.
 *
 * Claude Code encodes project paths by replacing '/' with '-' and '_' with '-'.
 * We reverse this by scanning real directories and encoding their paths the same way.
 */
async function buildProjectPathMap() {
    const result = new Map();
    // Also add the home directory itself (for projects at ~/CLAUDE.md)
    const homeDir = node_os_1.default.homedir();
    for (const searchDir of SEARCH_DIRS) {
        try {
            const entries = await promises_1.default.readdir(searchDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const fullPath = node_path_1.default.join(searchDir, entry.name);
                // Encode the same way Claude Code does: replace / and _ with -
                const encoded = '-' + fullPath.split('/').filter(Boolean).join('-').replace(/_/g, '-');
                result.set(encoded, fullPath);
            }
        }
        catch {
            // Search dir doesn't exist, skip
        }
    }
    // Also map the home directory and each search dir as potential project roots
    const extraPaths = [homeDir, ...SEARCH_DIRS];
    for (const p of extraPaths) {
        const encoded = '-' + p.split('/').filter(Boolean).join('-').replace(/_/g, '-');
        result.set(encoded, p);
    }
    return result;
}
function encodeProjectPath(projectPath) {
    return '-' + projectPath.split('/').filter(Boolean).join('-').replace(/_/g, '-');
}
async function scanProjectAtPathInternal(projectPath, encodedName) {
    const agentsDir = node_path_1.default.join(projectPath, '.claude', 'agents');
    const workflowsDir = node_path_1.default.join(projectPath, '.claude', 'workflows');
    const skillsDir = node_path_1.default.join(projectPath, '.claude', 'skills');
    const memoryDir = node_path_1.default.join(CLAUDE_PROJECTS_META_DIR, encodedName, 'memory');
    const displayName = node_path_1.default.basename(projectPath);
    const [agents, workflows, skills, memories, claudeMd] = await Promise.all([
        listAgents(agentsDir),
        listWorkflows(workflowsDir),
        listSkills(skillsDir),
        listMemories(memoryDir),
        readClaudeMd(projectPath),
    ]);
    return {
        id: encodeURIComponent(projectPath),
        name: displayName,
        path: projectPath,
        agents,
        workflows,
        skills,
        memories,
        claudeMd,
    };
}
/**
 * Scan a project at the given path. Creates .claude/ directory if needed.
 * This is the public API used by the open/create routes.
 */
async function scanProjectAtPath(projectPath) {
    const encoded = encodeProjectPath(projectPath);
    // Ensure .claude directory exists
    const claudeDir = node_path_1.default.join(projectPath, '.claude');
    if (!(await (0, file_ops_1.fileExists)(claudeDir))) {
        await promises_1.default.mkdir(claudeDir, { recursive: true });
    }
    const project = await scanProjectAtPathInternal(projectPath, encoded);
    if (!project) {
        // Return a minimal project even without CLAUDE.md
        return {
            id: encodeURIComponent(projectPath),
            name: node_path_1.default.basename(projectPath),
            path: projectPath,
            agents: [],
            workflows: [],
            skills: [],
            memories: [],
        };
    }
    return project;
}
async function discoverProjectEntries() {
    try {
        const metaEntries = await promises_1.default.readdir(CLAUDE_PROJECTS_META_DIR, { withFileTypes: true });
        const metaDirs = metaEntries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
        const pathMap = await buildProjectPathMap();
        const results = [];
        for (const encoded of metaDirs) {
            const projectPath = pathMap.get(encoded);
            if (projectPath) {
                results.push({ encoded, projectPath });
            }
        }
        return results;
    }
    catch {
        return [];
    }
}
async function scanAllProjectSummaries() {
    const claudeHome = (0, claude_home_1.getClaudeHome)();
    const globalSummary = { id: 'global', name: 'Global', path: claudeHome };
    const entries = await discoverProjectEntries();
    const summaries = [globalSummary];
    for (const { encoded, projectPath } of entries) {
        const claudeMdPath = node_path_1.default.join(projectPath, 'CLAUDE.md');
        if (await (0, file_ops_1.fileExists)(claudeMdPath)) {
            summaries.push({
                id: encodeURIComponent(encoded),
                name: node_path_1.default.basename(projectPath),
                path: projectPath,
            });
        }
    }
    return summaries;
}
async function scanAllProjects() {
    const globalProject = await scanGlobalProject();
    const entries = await discoverProjectEntries();
    const projectResults = await Promise.all(entries.map(({ encoded, projectPath }) => scanProjectAtPathInternal(projectPath, encoded).catch(() => null)));
    const projects = projectResults.filter((p) => p !== null);
    return [globalProject, ...projects];
}
async function scanProjectById(id) {
    if (id === 'global') {
        return scanGlobalProject();
    }
    const decoded = decodeURIComponent(id);
    // New path-based ID: decoded value starts with '/'
    if (decoded.startsWith('/')) {
        if (await (0, file_ops_1.fileExists)(decoded)) {
            return scanProjectAtPath(decoded);
        }
        return null;
    }
    // Legacy encoded directory name
    const pathMap = await buildProjectPathMap();
    const projectPath = pathMap.get(decoded) ?? null;
    if (projectPath === null)
        return null;
    return scanProjectAtPathInternal(projectPath, decoded);
}
//# sourceMappingURL=project-scanner.js.map