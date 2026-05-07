"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClaudeHome = getClaudeHome;
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
function getClaudeHome() {
    return process.env.CLAUDE_HOME ?? node_path_1.default.join(node_os_1.default.homedir(), '.claude');
}
//# sourceMappingURL=claude-home.js.map