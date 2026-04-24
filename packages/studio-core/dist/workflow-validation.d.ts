export interface ValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}
export declare function validateWorkflow(workflow: unknown): ValidationResult;
