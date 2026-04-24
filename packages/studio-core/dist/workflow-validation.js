"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflow = validateWorkflow;
function validateWorkflow(workflow) {
    const errors = [];
    if (!workflow || typeof workflow !== 'object') {
        return { valid: false, errors: ['Workflow must be a non-null object'] };
    }
    const wf = workflow;
    if (typeof wf.name !== 'string' || wf.name.trim() === '') {
        errors.push('Workflow must have a non-empty "name" field');
    }
    if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
        errors.push('Workflow must have a non-empty "nodes" array');
        return { valid: false, errors };
    }
    const nodes = wf.nodes;
    const nodeIds = new Set();
    const duplicateIds = new Set();
    // Check required fields and collect IDs
    for (const [index, node] of nodes.entries()) {
        if (!node || typeof node !== 'object') {
            errors.push(`Node at index ${index} must be an object`);
            continue;
        }
        if (typeof node.id !== 'string' || node.id.trim() === '') {
            errors.push(`Node at index ${index} is missing required field "id"`);
        }
        else if (nodeIds.has(node.id)) {
            duplicateIds.add(node.id);
        }
        else {
            nodeIds.add(node.id);
        }
        if (typeof node.agent !== 'string' || node.agent.trim() === '') {
            errors.push(`Node "${node.id ?? index}" is missing required field "agent"`);
        }
        if (typeof node.task !== 'string' || node.task.trim() === '') {
            errors.push(`Node "${node.id ?? index}" is missing required field "task"`);
        }
    }
    for (const id of duplicateIds) {
        errors.push(`Duplicate node ID: "${id}"`);
    }
    // Check depends_on references
    for (const node of nodes) {
        const deps = node.depends_on;
        if (!Array.isArray(deps))
            continue;
        const nodeId = typeof node.id === 'string' ? node.id : '(unknown)';
        for (const dep of deps) {
            if (typeof dep !== 'string') {
                errors.push(`Node "${nodeId}" has non-string dependency: ${JSON.stringify(dep)}`);
            }
            else if (!nodeIds.has(dep)) {
                errors.push(`Node "${nodeId}" depends on unknown node: "${dep}"`);
            }
        }
    }
    // Check circular dependencies
    const circularErrors = detectCircularDependencies(nodes);
    errors.push(...circularErrors);
    return { valid: errors.length === 0, errors };
}
function detectCircularDependencies(nodes) {
    const errors = [];
    const depsMap = new Map();
    for (const node of nodes) {
        if (typeof node.id === 'string') {
            depsMap.set(node.id, node.depends_on ?? []);
        }
    }
    const visited = new Set();
    const inStack = new Set();
    function visit(id, path) {
        if (inStack.has(id)) {
            const cycleStart = path.indexOf(id);
            const cycle = [...path.slice(cycleStart), id];
            errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
            return true;
        }
        if (visited.has(id))
            return false;
        visited.add(id);
        inStack.add(id);
        const deps = depsMap.get(id) ?? [];
        for (const dep of deps) {
            if (depsMap.has(dep)) {
                visit(dep, [...path, id]);
            }
        }
        inStack.delete(id);
        return false;
    }
    for (const node of nodes) {
        if (typeof node.id === 'string' && !visited.has(node.id)) {
            visit(node.id, []);
        }
    }
    return errors;
}
//# sourceMappingURL=workflow-validation.js.map