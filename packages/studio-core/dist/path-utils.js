"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandHome = expandHome;
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
/**
 * Expands a leading `~` or `~/` in a path to the user's home directory.
 */
function expandHome(input) {
    if (input.startsWith('~/')) {
        return node_path_1.default.join(node_os_1.default.homedir(), input.slice(2));
    }
    if (input === '~') {
        return node_os_1.default.homedir();
    }
    return input;
}
//# sourceMappingURL=path-utils.js.map