import { makeRestApiRequest } from '@n8n/rest-api-client';
import type { IRestApiContext } from '@n8n/rest-api-client';
import type {
	AiWorkflowBuilderApplyDraftResponse,
	AiWorkflowBuilderConversationDetail,
	AiWorkflowBuilderConversationSummary,
	AiWorkflowBuilderCreateDraftFromMessageResponse,
	AiWorkflowBuilderListConversationsResponse,
	AiWorkflowBuilderSendMessageResponse,
} from '@n8n/api-types';

export async function listConversations(
	ctx: IRestApiContext,
	projectId: string,
	params: { limit?: number; offset?: number } = {},
): Promise<AiWorkflowBuilderListConversationsResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderListConversationsResponse>(
		ctx,
		'GET',
		`/projects/${projectId}/ai-workflow-builder/conversations`,
		params,
	);
}

export async function createConversation(
	ctx: IRestApiContext,
	projectId: string,
	payload: { clientMessageId: string; content: string },
): Promise<AiWorkflowBuilderSendMessageResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderSendMessageResponse>(
		ctx,
		'POST',
		`/projects/${projectId}/ai-workflow-builder/conversations`,
		payload,
	);
}

export async function getConversation(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
): Promise<AiWorkflowBuilderConversationDetail> {
	return await makeRestApiRequest<AiWorkflowBuilderConversationDetail>(
		ctx,
		'GET',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}`,
	);
}

export async function sendConversationMessage(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
	payload: { clientMessageId: string; content: string },
): Promise<AiWorkflowBuilderSendMessageResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderSendMessageResponse>(
		ctx,
		'POST',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}/messages`,
		payload,
	);
}

export async function retryConversationMessage(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
	messageId: string,
): Promise<AiWorkflowBuilderSendMessageResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderSendMessageResponse>(
		ctx,
		'POST',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}/messages/${messageId}/retry`,
	);
}

export async function createDraftFromMessage(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
	messageId: string,
): Promise<AiWorkflowBuilderCreateDraftFromMessageResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderCreateDraftFromMessageResponse>(
		ctx,
		'POST',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}/messages/${messageId}/draft`,
	);
}

export async function renameConversation(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
	title: string,
): Promise<AiWorkflowBuilderConversationSummary> {
	return await makeRestApiRequest<AiWorkflowBuilderConversationSummary>(
		ctx,
		'PATCH',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}`,
		{ title },
	);
}

export async function deleteConversation(
	ctx: IRestApiContext,
	projectId: string,
	conversationId: string,
): Promise<{ success: boolean }> {
	return await makeRestApiRequest<{ success: boolean }>(
		ctx,
		'DELETE',
		`/projects/${projectId}/ai-workflow-builder/conversations/${conversationId}`,
	);
}

export async function applyDraft(
	ctx: IRestApiContext,
	projectId: string,
	draftId: string,
): Promise<AiWorkflowBuilderApplyDraftResponse> {
	return await makeRestApiRequest<AiWorkflowBuilderApplyDraftResponse>(
		ctx,
		'POST',
		`/projects/${projectId}/ai-workflow-builder/drafts/${draftId}/apply`,
	);
}
