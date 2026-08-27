export interface LlmNodeData {
  systemPrompt: string;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  temperature: number;
}

export interface GraphNode {
  id: string;
  type: 'llm';
  data: LlmNodeData;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphDefinition {
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
