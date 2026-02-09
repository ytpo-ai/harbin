export interface AIModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'local';
  model: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: any;
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  description: string;
  model: AIModel;
  capabilities: string[];
  systemPrompt: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  agents: Agent[];
  settings: TeamSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamSettings {
  collaborationMode: 'pipeline' | 'parallel' | 'hierarchical' | 'discussion';
  maxConcurrentAgents: number;
  votingEnabled: boolean;
  consensusThreshold: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedAgents: string[];
  teamId: string;
  messages: ChatMessage[];
  result?: any;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface Discussion {
  id: string;
  taskId: string;
  participants: string[];
  messages: DiscussionMessage[];
  status: 'active' | 'concluded' | 'paused';
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscussionMessage {
  id: string;
  agentId: string;
  content: string;
  type: 'opinion' | 'question' | 'agreement' | 'disagreement' | 'suggestion';
  timestamp: Date;
  metadata?: any;
}