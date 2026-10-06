export interface LlmNodeData {
    systemPrompt: string;
    provider: 'anthropic' | 'openai' | 'google';
    model: string;
    temperature: number;
}
export interface FormField {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'messages';
    required: boolean;
    helpText?: string;
}
export interface FormNodeData {
    label: string;
    prompt: string;
    assigneeMode: 'launcher' | 'specific_user';
    assigneeUserId?: string;
    fields: FormField[];
}
export type GraphNode = {
    id: string;
    type: 'llm';
    data: LlmNodeData;
} | {
    id: string;
    type: 'form';
    data: FormNodeData;
};
export interface GraphEdge {
    source: string;
    target: string;
}
export interface StateField {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'messages';
}
export interface GraphDefinition {
    entryNodeId: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    stateSchema: {
        fields: StateField[];
    };
}
