import {
	AiWorkflowBuilderCreateConversationDto,
	AiWorkflowBuilderListConversationsQueryDto,
	AiWorkflowBuilderRenameConversationDto,
	AiWorkflowBuilderSendMessageDto,
} from '@n8n/api-types';
import { AuthenticatedRequest } from '@n8n/db';
import {
	Body,
	Delete,
	Get,
	Patch,
	Post,
	ProjectScope,
	Query,
	RestController,
} from '@n8n/decorators';
import type { Response } from 'express';

import { AiWorkflowBuilderConversationsService } from './ai-workflow-builder-conversations.service';

@RestController('/projects/:projectId/ai-workflow-builder')
export class AiWorkflowBuilderConversationsController {
	constructor(private readonly conversationsService: AiWorkflowBuilderConversationsService) {}

	@Get('/conversations')
	@ProjectScope('workflow:read')
	async listConversations(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: Response,
		@Query query: AiWorkflowBuilderListConversationsQueryDto,
	) {
		return await this.conversationsService.listConversations({
			projectId: req.params.projectId,
			userId: req.user.id,
			limit: query.limit,
			offset: query.offset,
		});
	}

	@Post('/conversations')
	@ProjectScope('workflow:create')
	async createConversation(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: Response,
		@Body body: AiWorkflowBuilderCreateConversationDto,
	) {
		return await this.conversationsService.createConversationWithMessage({
			projectId: req.params.projectId,
			user: req.user,
			clientMessageId: body.clientMessageId,
			content: body.content,
		});
	}

	@Get('/conversations/:conversationId')
	@ProjectScope('workflow:read')
	async getConversation(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string }>,
		_res: Response,
	) {
		return await this.conversationsService.getConversation({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			userId: req.user.id,
		});
	}

	@Post('/conversations/:conversationId/messages')
	@ProjectScope('workflow:create')
	async sendMessage(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string }>,
		_res: Response,
		@Body body: AiWorkflowBuilderSendMessageDto,
	) {
		return await this.conversationsService.sendMessage({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			user: req.user,
			clientMessageId: body.clientMessageId,
			content: body.content,
		});
	}

	@Post('/conversations/:conversationId/messages/:messageId/retry')
	@ProjectScope('workflow:create')
	async retryMessage(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string; messageId: string }>,
		_res: Response,
	) {
		return await this.conversationsService.retryAssistantResponse({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			messageId: req.params.messageId,
			user: req.user,
		});
	}

	@Post('/conversations/:conversationId/messages/:messageId/draft')
	@ProjectScope('workflow:create')
	async createDraftFromMessage(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string; messageId: string }>,
		_res: Response,
	) {
		return await this.conversationsService.createDraftFromMessage({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			messageId: req.params.messageId,
			userId: req.user.id,
		});
	}

	@Patch('/conversations/:conversationId')
	@ProjectScope('workflow:update')
	async renameConversation(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string }>,
		_res: Response,
		@Body body: AiWorkflowBuilderRenameConversationDto,
	) {
		return await this.conversationsService.renameConversation({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			userId: req.user.id,
			title: body.title,
		});
	}

	@Delete('/conversations/:conversationId')
	@ProjectScope('workflow:update')
	async deleteConversation(
		req: AuthenticatedRequest<{ projectId: string; conversationId: string }>,
		_res: Response,
	) {
		return await this.conversationsService.deleteConversation({
			projectId: req.params.projectId,
			conversationId: req.params.conversationId,
			userId: req.user.id,
		});
	}

	@Post('/drafts/:draftId/apply')
	@ProjectScope('workflow:create')
	async applyDraft(
		req: AuthenticatedRequest<{ projectId: string; draftId: string }>,
		_res: Response,
	) {
		return await this.conversationsService.applyDraft({
			projectId: req.params.projectId,
			draftId: req.params.draftId,
			user: req.user,
		});
	}
}
