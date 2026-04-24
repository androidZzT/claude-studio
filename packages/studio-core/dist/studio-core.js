"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudioCore = createStudioCore;
const file_ops_1 = require("./file-ops");
const project_scanner_1 = require("./project-scanner");
const project_creation_1 = require("./project-creation");
const execution_engine_1 = require("./execution-engine");
const workflow_validation_1 = require("./workflow-validation");
function createStudioCore() {
    return {
        resources: {
            readResourceFile: file_ops_1.readResourceFile,
            listResourceFiles: file_ops_1.listResourceFiles,
            writeResourceFile: file_ops_1.writeResourceFile,
            deleteResourceFile: file_ops_1.deleteResourceFile,
        },
        settings: {
            readSettings: file_ops_1.readSettings,
            writeSettings: file_ops_1.writeSettings,
            readProjectSettings: file_ops_1.readProjectSettings,
            writeProjectSharedSettings: file_ops_1.writeProjectSharedSettings,
            writeProjectLocalSettings: file_ops_1.writeProjectLocalSettings,
        },
        projects: {
            scanProjectAtPath: project_scanner_1.scanProjectAtPath,
            scanProjectById: project_scanner_1.scanProjectById,
            scanAllProjectSummaries: project_scanner_1.scanAllProjectSummaries,
            scanAllProjects: project_scanner_1.scanAllProjects,
            createProject: project_creation_1.createProject,
        },
        workflows: {
            validateWorkflow: workflow_validation_1.validateWorkflow,
        },
        files: {
            fileExists: file_ops_1.fileExists,
        },
        executions: {
            startExecution: execution_engine_1.startExecution,
            getExecution: execution_engine_1.getExecution,
            removeExecution: execution_engine_1.removeExecution,
        },
    };
}
//# sourceMappingURL=studio-core.js.map