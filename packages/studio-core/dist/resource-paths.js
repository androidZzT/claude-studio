"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResourceDir = getResourceDir;
exports.getSettingsPath = getSettingsPath;
exports.getRootConfigPath = getRootConfigPath;
exports.encodeProjectPath = encodeProjectPath;
exports.getProjectSharedSettingsPath = getProjectSharedSettingsPath;
exports.getProjectLocalSettingsPath = getProjectLocalSettingsPath;
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const claude_home_1 = require("./claude-home");
const RESOURCE_DIRS = {
    agents: 'agents',
    workflows: 'workflows',
    skills: 'skills',
    rules: 'rules',
    mcps: '',
    hooks: '',
    memories: '',
};
function getResourceDir(type) {
    const claudeHome = (0, claude_home_1.getClaudeHome)();
    const dir = RESOURCE_DIRS[type];
    if (!dir) {
        throw new Error(`Resource type "${type}" is stored in settings.json, not as files`);
    }
    return node_path_1.default.join(claudeHome, dir);
}
function getSettingsPath() {
    return node_path_1.default.join((0, claude_home_1.getClaudeHome)(), 'settings.json');
}
function getRootConfigPath() {
    return node_path_1.default.join(node_os_1.default.homedir(), '.claude.json');
}
function encodeProjectPath(projectPath) {
    return '-' + projectPath.replace(/[/_]/g, '-');
}
function getProjectSharedSettingsPath(projectPath) {
    return node_path_1.default.join(projectPath, '.claude', 'settings.json');
}
function getProjectLocalSettingsPath(projectPath) {
    const claudeHome = (0, claude_home_1.getClaudeHome)();
    const encoded = encodeProjectPath(projectPath);
    return node_path_1.default.join(claudeHome, 'projects', encoded, 'settings.json');
}
//# sourceMappingURL=resource-paths.js.map