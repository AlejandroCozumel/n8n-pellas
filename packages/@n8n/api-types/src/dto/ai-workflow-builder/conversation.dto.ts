import { z } from 'zod';

import { Z } from '../../zod-class';

export const AI_WORKFLOW_BUILDER_CONVERSATION_STATUSES = [
	'active',
	'generated',
	'archived',
	'failed',
] as const;
export type AiWorkflowBuilderConversationStatus =
	(typeof AI_WORKFLOW_BUILDER_CONVERSATION_STATUSES)[number];

export const AI_WORKFLOW_BUILDER_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type AiWorkflowBuilderMessageRole = (typeof AI_WORKFLOW_BUILDER_MESSAGE_ROLES)[number];

export const AI_WORKFLOW_BUILDER_MESSAGE_STATUSES = ['pending', 'success', 'error'] as const;
export type AiWorkflowBuilderMessageStatus = (typeof AI_WORKFLOW_BUILDER_MESSAGE_STATUSES)[number];

export const AI_WORKFLOW_BUILDER_RESPONSE_STATES = [
	'generated',
	'needs_clarification',
	'partial',
	'unsupported',
	'error',
] as const;
export type AiWorkflowBuilderResponseState = (typeof AI_WORKFLOW_BUILDER_RESPONSE_STATES)[number];

export const workflowOutlineStepSchema = z.object({
	label: z.string().min(1).max(80),
	nodeType: z.string().max(128).optional(),
	description: z.string().min(1).max(500),
});

export type AiWorkflowBuilderWorkflowOutlineStep = z.infer<typeof workflowOutlineStepSchema>;

export const workflowOutlineSchema = z.object({
	steps: z.array(workflowOutlineStepSchema).max(20),
});

export type AiWorkflowBuilderWorkflowOutline = z.infer<typeof workflowOutlineSchema>;

export const generatedWorkflowSchema = z.object({
	name: z.string().min(1).max(128),
	nodes: z.array(z.record(z.unknown())),
	connections: z.record(z.unknown()),
	settings: z.record(z.unknown()),
	active: z.boolean(),
});

export type AiWorkflowBuilderGeneratedWorkflow = z.infer<typeof generatedWorkflowSchema>;

export const assistantMessageMetadataSchema = z
	.object({
		confidence: z.number().min(0).max(1).optional(),
		suggestedReplies: z.array(z.string().min(1).max(120)).max(6).optional(),
		workflowOutline: workflowOutlineSchema.optional(),
		draftId: z.string().uuid().optional(),
		generatedWorkflowId: z.string().optional(),
		errorCode: z.string().max(80).optional(),
		missingInformation: z.array(z.string().min(1).max(200)).max(10).optional(),
		attemptCount: z.number().int().min(1).optional(),
	})
	.passthrough();

export type AiWorkflowBuilderAssistantMessageMetadata = z.infer<
	typeof assistantMessageMetadataSchema
>;

export interface AiWorkflowBuilderConversationSummary {
	id: string;
	projectId: string;
	title: string;
	status: AiWorkflowBuilderConversationStatus;
	appliedWorkflowId: string | null;
	latestMessagePreview: string;
	createdAt: string;
	updatedAt: string;
	lastMessageAt: string;
}

export interface AiWorkflowBuilderMessage {
	id: string;
	conversationId: string;
	role: AiWorkflowBuilderMessageRole;
	content: string;
	status: AiWorkflowBuilderMessageStatus;
	responseState: AiWorkflowBuilderResponseState | null;
	metadata: AiWorkflowBuilderAssistantMessageMetadata | null;
	createdAt: string;
	updatedAt: string;
}

export interface AiWorkflowBuilderDraftSummary {
	id: string;
	conversationId: string;
	messageId: string;
	workflowName: string;
	workflowOutline: AiWorkflowBuilderWorkflowOutline;
	createdWorkflowId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AiWorkflowBuilderConversationDetail {
	conversation: AiWorkflowBuilderConversationSummary;
	messages: AiWorkflowBuilderMessage[];
	drafts: AiWorkflowBuilderDraftSummary[];
}

export interface AiWorkflowBuilderListConversationsResponse {
	conversations: AiWorkflowBuilderConversationSummary[];
	total: number;
	limit: number;
	offset: number;
}

export interface AiWorkflowBuilderSendMessageResponse extends AiWorkflowBuilderConversationDetail {
	userMessage: AiWorkflowBuilderMessage;
	assistantMessage: AiWorkflowBuilderMessage;
}

export interface AiWorkflowBuilderApplyDraftResponse {
	workflowId: string;
	conversation: AiWorkflowBuilderConversationSummary;
	draft: AiWorkflowBuilderDraftSummary;
}

export interface AiWorkflowBuilderCreateDraftFromMessageResponse {
	conversation: AiWorkflowBuilderConversationSummary;
	message: AiWorkflowBuilderMessage;
	draft: AiWorkflowBuilderDraftSummary;
}

export class AiWorkflowBuilderListConversationsQueryDto extends Z.class({
	limit: z.coerce.number().int().min(1).max(100).default(30),
	offset: z.coerce.number().int().min(0).default(0),
}) {}

export class AiWorkflowBuilderCreateConversationDto extends Z.class({
	clientMessageId: z.string().uuid(),
	content: z.string().min(1).max(3000),
}) {}

export class AiWorkflowBuilderSendMessageDto extends Z.class({
	clientMessageId: z.string().uuid(),
	content: z.string().min(1).max(3000),
}) {}

export class AiWorkflowBuilderRenameConversationDto extends Z.class({
	title: z.string().trim().min(1).max(80),
}) {}
