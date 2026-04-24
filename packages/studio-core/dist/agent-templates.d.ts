export interface AgentFrontmatter {
    readonly model: string;
    readonly tools: readonly string[];
}
export interface AgentTemplate {
    readonly id: string;
    readonly name: string;
    readonly category: 'Development' | 'Quality' | 'Operations' | 'Management';
    readonly description: string;
    readonly frontmatter: AgentFrontmatter;
    readonly body: string;
}
export declare const AGENT_TEMPLATES: readonly AgentTemplate[];
export declare const AGENT_TEMPLATE_CATEGORIES: readonly ["Development", "Quality", "Operations", "Management"];
export type AgentTemplateCategory = (typeof AGENT_TEMPLATE_CATEGORIES)[number];
export declare function getTemplatesByCategory(category: AgentTemplateCategory): readonly AgentTemplate[];
export declare const ALL_AGENT_TOOLS: readonly ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Agent", "SendMessage"];
export declare const AGENT_MODELS: readonly [{
    readonly value: "opus";
    readonly label: "Opus";
}, {
    readonly value: "sonnet";
    readonly label: "Sonnet";
}, {
    readonly value: "haiku";
    readonly label: "Haiku";
}];
