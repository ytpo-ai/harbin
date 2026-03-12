import type { AIModel, ChatMessage } from '@libs/contracts';

export type { AIModel, ChatMessage };

export interface Agent {
	id?: string;
	name: string;
	roleId: string;
	description: string;
	model: AIModel;
	config?: Record<string, unknown>;
	capabilities: string[];
	systemPrompt: string;
	isActive: boolean;
	tools: string[]; // 可使用的工具ID列表
	permissions: string[]; // 权限ID列表
	personality: {
		workEthic: number; // 工作伦理 0-100
		creativity: number; // 创造力 0-100
		leadership: number; // 领导力 0-100
		teamwork: number; // 团队协作 0-100
	};
	learningAbility: number; // 学习能力 0-100
	salary?: number;
	performanceScore?: number;
	apiKeyId?: string; // 关联的API密钥ID
	createdAt?: Date;
	updatedAt?: Date;
}

export interface Team {
	id?: string;
	name: string;
	description: string;
	agents: Agent[];
	settings: TeamSettings;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface TeamSettings {
	collaborationMode: 'pipeline' | 'parallel' | 'hierarchical' | 'discussion';
	maxConcurrentAgents: number;
	votingEnabled: boolean;
	consensusThreshold: number;
}

export interface Task {
	id?: string;
	title: string;
	description: string;
	type: string;
	priority: 'low' | 'medium' | 'high' | 'urgent';
	status: 'pending' | 'in_progress' | 'completed' | 'failed';
	assignedAgents: string[];
	teamId: string;
	messages: ChatMessage[];
	result?: any;
	createdAt?: Date;
	updatedAt?: Date;
	completedAt?: Date;
}

export interface Discussion {
	id?: string;
	taskId: string;
	participants: string[];
	messages: DiscussionMessage[];
	status: 'active' | 'concluded' | 'paused';
	createdAt?: Date;
	updatedAt?: Date;
}

export interface DiscussionMessage {
	id: string;
	agentId: string;
	content: string;
	type: 'opinion' | 'question' | 'agreement' | 'disagreement' | 'suggestion' | 'conclusion';
	timestamp: Date;
	metadata?: any;
}

// ===== 新增组织架构相关类型 =====

export interface Tool {
	id: string;
	canonicalId?: string;
	provider?: string;
	toolkitId?: string;
	namespace?: string;
	resource?: string;
	action?: string;
	name: string;
	description: string;
	prompt?: string;
	type: 'code_execution' | 'web_search' | 'file_operation' | 'data_analysis' | 'video_editing' | 'api_call' | 'custom';
	category: string;
	capabilitySet?: string[];
	tags?: string[];
	status?: 'active' | 'hidden' | 'deprecated';
	deprecated?: boolean;
	replacedBy?: string;
	aliases?: string[];
	enabled: boolean;
	config?: any;
	inputSchema?: any;
	outputSchema?: any;
	requiredPermissions: Permission[];
	tokenCost?: number;
	executionTime?: number;
}

export interface Toolkit {
	id: string;
	provider: string;
	namespace: string;
	name: string;
	description?: string;
	version?: string;
	authStrategy?: 'oauth2' | 'apiKey' | 'none';
	status?: 'active' | 'disabled' | 'deprecated';
	rateLimitPolicyId?: string;
	defaultTimeoutMs?: number;
	metadata?: Record<string, unknown>;
}

export interface Permission {
	id: string;
	name: string;
	description: string;
	level: 'basic' | 'intermediate' | 'advanced' | 'admin';
}

export interface Skill {
	id: string;
	name: string;
	slug: string;
	description: string;
	category: string;
	tags: string[];
	sourceType: 'manual' | 'github' | 'web' | 'internal';
	sourceUrl?: string;
	provider: string;
	version: string;
	status: 'active' | 'experimental' | 'deprecated' | 'disabled';
	confidenceScore: number;
	usageCount?: number;
	discoveredBy?: string;
	metadata?: any;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface AgentSkill {
	id: string;
	agentId: string;
	skillId: string;
	proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
	enabled: boolean;
	assignedBy?: string;
	note?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface SkillSuggestion {
	id: string;
	agentId: string;
	skillId: string;
	reason: string;
	priority: 'low' | 'medium' | 'high' | 'critical';
	status: 'pending' | 'accepted' | 'rejected' | 'applied';
	score: number;
	suggestedBy?: string;
	context?: any;
	reviewedAt?: Date;
	appliedAt?: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface AgentRole {
	id: string;
	title: string;
	description: string;
	department: string;
	level: 'junior' | 'senior' | 'lead' | 'manager' | 'executive';
	requiredTools: string[];
	requiredCapabilities: string[];
	maxEmployees?: number;
	salaryRange: {
		min: number;
		max: number;
	};
	stockOptions?: number;
}

export interface AgentEmployee {
	id: string;
	agentId: string;
	roleId: string;
	joinDate: Date;
	status: 'active' | 'probation' | 'terminated';
	performance: PerformanceRecord[];
	salary: number;
	stockOptions: number;
	totalShares: number;
	lastEvaluationDate?: Date;
	terminationReason?: string;
}

export interface PerformanceRecord {
	id: string;
	evaluationDate: Date;
	kpis: {
		taskCompletionRate: number;
		codeQuality: number;
		collaboration: number;
		innovation: number;
		efficiency: number;
	};
	tokenConsumption: {
		total: number;
		cost: number;
	};
	completedTasks: number;
	earnings: number;
	notes: string;
	evaluator: string;
}

export interface ToolExecution {
	id: string;
	traceId?: string;
	requestedToolId?: string;
	resolvedToolId?: string;
	toolId: string;
	agentId: string;
	taskId?: string;
	idempotencyKey?: string;
	parameters: any;
	result?: any;
	status: 'pending' | 'executing' | 'completed' | 'failed';
	tokenCost: number;
	executionTime: number;
	retryCount: number;
	error?: string;
	errorCode?: string;
	timestamp: Date;
}
