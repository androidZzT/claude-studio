interface WorkflowNodeRecord {
    readonly id: string;
    readonly agent: string;
    readonly task: string;
    readonly depends_on?: readonly string[];
    readonly roundtrip?: readonly string[];
    readonly checkpoint?: boolean;
    readonly skills?: readonly string[];
    readonly mcp_servers?: readonly string[];
}
interface WorkflowRecord {
    readonly name?: string;
    readonly description?: string;
    readonly version?: number;
    readonly nodes: readonly WorkflowNodeRecord[];
}
export declare function parseWorkflowDocument(content: string): WorkflowRecord | null;
export declare function formatWorkflowDocument(input: string | Record<string, unknown>): string;
export {};
