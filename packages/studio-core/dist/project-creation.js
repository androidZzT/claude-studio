"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProject = createProject;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const file_ops_1 = require("./file-ops");
const project_scanner_1 = require("./project-scanner");
const path_utils_1 = require("./path-utils");
const project_templates_1 = require("./project-templates");
function buildClaudeMd(name) {
    return [
        `# ${name}`,
        '',
        '## Overview',
        'Describe your project here.',
        '',
        '## Team',
        'Define your agent team roles.',
        '',
        '## Workflows',
        'Describe your key workflows.',
        '',
    ].join('\n');
}
async function createProject(params) {
    const name = params.name.trim();
    if (!name) {
        throw new Error('Missing required field: name');
    }
    const parentDir = (0, path_utils_1.expandHome)(params.parentDir ?? '~/Claude');
    const projectPath = node_path_1.default.join(parentDir, name);
    if (await (0, file_ops_1.fileExists)(projectPath)) {
        throw new Error(`Directory already exists: ${projectPath}`);
    }
    await promises_1.default.mkdir(node_path_1.default.join(projectPath, '.claude', 'agents'), { recursive: true });
    await promises_1.default.mkdir(node_path_1.default.join(projectPath, '.claude', 'workflows'), { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(projectPath, 'CLAUDE.md'), buildClaudeMd(name), 'utf-8');
    const template = params.template ?? 'blank';
    const agents = (0, project_templates_1.getProjectTemplateAgents)(template);
    for (const agent of agents) {
        const fileContent = agent.frontmatter && Object.keys(agent.frontmatter).length > 0
            ? gray_matter_1.default.stringify(agent.body, agent.frontmatter)
            : agent.body;
        await promises_1.default.writeFile(node_path_1.default.join(projectPath, '.claude', 'agents', `${agent.id}.md`), fileContent, 'utf-8');
    }
    return (0, project_scanner_1.scanProjectAtPath)(projectPath);
}
//# sourceMappingURL=project-creation.js.map