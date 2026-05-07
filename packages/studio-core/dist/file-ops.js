"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileExists = fileExists;
exports.readResourceFile = readResourceFile;
exports.listResourceFiles = listResourceFiles;
exports.writeResourceFile = writeResourceFile;
exports.deleteResourceFile = deleteResourceFile;
exports.readSettings = readSettings;
exports.writeSettings = writeSettings;
exports.readProjectSettings = readProjectSettings;
exports.writeProjectSharedSettings = writeProjectSharedSettings;
exports.writeProjectLocalSettings = writeProjectLocalSettings;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const workflow_document_1 = require("./workflow-document");
const resource_paths_1 = require("./resource-paths");
const LEGACY_WORKFLOW_EXTS = ['.yaml', '.yml'];
function isResourceFileForType(fileName, type) {
    if (type === 'workflows') {
        return fileName.endsWith('.md') || fileName.endsWith('.yaml') || fileName.endsWith('.yml');
    }
    return fileName.endsWith('.md');
}
async function fileExists(filePath) {
    try {
        await promises_1.default.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readResourceFile(filePath, type, baseDir) {
    const content = await promises_1.default.readFile(filePath, 'utf-8');
    const ext = node_path_1.default.extname(filePath);
    const baseName = node_path_1.default.basename(filePath, ext);
    const name = type === 'skills' && baseName === 'SKILL'
        ? node_path_1.default.basename(node_path_1.default.dirname(filePath))
        : baseName;
    const idBase = baseDir
        ? node_path_1.default.relative(baseDir, filePath).replace(/\.(md|yaml|yml)$/, '')
        : name;
    const id = encodeURIComponent(idBase);
    if (type === 'workflows') {
        const parsed = (0, workflow_document_1.parseWorkflowDocument)(content);
        if (!parsed) {
            return { id, type, name, path: filePath, content };
        }
        return { id, type, name, path: filePath, content, frontmatter: parsed };
    }
    if (filePath.endsWith('.md')) {
        const { data, content: body } = (0, gray_matter_1.default)(content);
        return {
            id,
            type,
            name,
            path: filePath,
            content: body,
            frontmatter: Object.keys(data).length > 0 ? data : undefined,
        };
    }
    return { id, type, name, path: filePath, content };
}
async function listResourceFiles(type) {
    const dir = (0, resource_paths_1.getResourceDir)(type);
    if (!(await fileExists(dir))) {
        return [];
    }
    const entries = await promises_1.default.readdir(dir, { withFileTypes: true, recursive: true });
    const files = entries
        .filter((e) => e.isFile() && isResourceFileForType(e.name, type))
        .map((e) => node_path_1.default.join(e.parentPath ?? e.path, e.name));
    const resources = await Promise.all(files.map((f) => readResourceFile(f, type, dir).catch(() => null)));
    return resources.filter((r) => r !== null);
}
async function writeResourceFile(type, id, content, frontmatter) {
    const dir = (0, resource_paths_1.getResourceDir)(type);
    await promises_1.default.mkdir(dir, { recursive: true });
    const name = decodeURIComponent(id);
    const ext = '.md';
    const filePath = node_path_1.default.join(dir, `${name}${ext}`);
    let fileContent;
    if (type === 'workflows') {
        const parsedFromContent = (0, workflow_document_1.parseWorkflowDocument)(content);
        const workflowObj = parsedFromContent
            ?? ((frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)) ? frontmatter : null);
        fileContent = workflowObj ? (0, workflow_document_1.formatWorkflowDocument)(workflowObj) : content;
    }
    else if (frontmatter && Object.keys(frontmatter).length > 0) {
        fileContent = gray_matter_1.default.stringify(content, frontmatter);
    }
    else {
        fileContent = content;
    }
    await promises_1.default.writeFile(filePath, fileContent, 'utf-8');
    if (type === 'workflows') {
        for (const legacyExt of LEGACY_WORKFLOW_EXTS) {
            const legacyPath = node_path_1.default.join(dir, `${name}${legacyExt}`);
            if (await fileExists(legacyPath)) {
                await promises_1.default.unlink(legacyPath);
            }
        }
    }
    return readResourceFile(filePath, type, dir);
}
async function deleteResourceFile(type, id) {
    const dir = (0, resource_paths_1.getResourceDir)(type);
    const name = decodeURIComponent(id);
    if (type === 'workflows') {
        const workflowCandidates = [
            node_path_1.default.join(dir, `${name}.md`),
            ...LEGACY_WORKFLOW_EXTS.map((ext) => node_path_1.default.join(dir, `${name}${ext}`)),
        ];
        for (const candidate of workflowCandidates) {
            if (await fileExists(candidate)) {
                await promises_1.default.unlink(candidate);
                return;
            }
        }
        throw new Error(`Resource not found: ${name}`);
    }
    const filePath = node_path_1.default.join(dir, `${name}.md`);
    if (!(await fileExists(filePath))) {
        throw new Error(`Resource not found: ${name}`);
    }
    await promises_1.default.unlink(filePath);
}
async function readJsonFile(filePath) {
    if (!(await fileExists(filePath))) {
        return {};
    }
    const content = await promises_1.default.readFile(filePath, 'utf-8');
    return JSON.parse(content);
}
async function readSettings() {
    const settings = await readJsonFile((0, resource_paths_1.getSettingsPath)());
    const rootConfig = await readJsonFile((0, resource_paths_1.getRootConfigPath)());
    const rootMcpServers = (rootConfig.mcpServers ?? {});
    const settingsMcpServers = (settings.mcpServers ?? {});
    const mergedMcpServers = { ...rootMcpServers, ...settingsMcpServers };
    return {
        ...settings,
        ...(Object.keys(mergedMcpServers).length > 0 ? { mcpServers: mergedMcpServers } : {}),
    };
}
async function writeSettings(settings) {
    const settingsPath = (0, resource_paths_1.getSettingsPath)();
    await promises_1.default.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
async function readProjectSettings(projectPath) {
    const shared = await readJsonFile((0, resource_paths_1.getProjectSharedSettingsPath)(projectPath));
    const local = await readJsonFile((0, resource_paths_1.getProjectLocalSettingsPath)(projectPath));
    return { shared, local };
}
async function writeProjectSharedSettings(projectPath, settings) {
    const filePath = (0, resource_paths_1.getProjectSharedSettingsPath)(projectPath);
    await promises_1.default.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await promises_1.default.writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
async function writeProjectLocalSettings(projectPath, settings) {
    const filePath = (0, resource_paths_1.getProjectLocalSettingsPath)(projectPath);
    await promises_1.default.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await promises_1.default.writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
//# sourceMappingURL=file-ops.js.map