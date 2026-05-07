"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_TEMPLATES = void 0;
exports.getProjectTemplateAgents = getProjectTemplateAgents;
const agent_templates_1 = require("./agent-templates");
exports.PROJECT_TEMPLATES = [
    { id: 'blank', name: 'Blank', description: 'Empty project with CLAUDE.md' },
    { id: 'dev-team', name: 'Dev Team', description: 'Architect, coders, reviewer, tester' },
    { id: 'ops-team', name: 'Ops Team', description: 'Team lead and ops operator' },
];
const DEV_TEAM_IDS = ['architect', 'frontend-coder', 'backend-coder', 'code-reviewer', 'tester'];
const OPS_TEAM_IDS = ['team-lead', 'ops-operator'];
function pickTemplates(ids) {
    return ids
        .map((id) => agent_templates_1.AGENT_TEMPLATES.find((t) => t.id === id))
        .filter((t) => t !== undefined);
}
function getProjectTemplateAgents(template) {
    switch (template) {
        case 'dev-team':
            return pickTemplates(DEV_TEAM_IDS);
        case 'ops-team':
            return pickTemplates(OPS_TEAM_IDS);
        default:
            return [];
    }
}
//# sourceMappingURL=project-templates.js.map