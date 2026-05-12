import type {
	AiWorkflowBuilderAssistantMessageMetadata,
	AiWorkflowBuilderConversationDetail,
	AiWorkflowBuilderConversationSummary,
	AiWorkflowBuilderCreateDraftFromMessageResponse,
	AiWorkflowBuilderDraftSummary,
	AiWorkflowBuilderGeneratedWorkflow,
	AiWorkflowBuilderListConversationsResponse,
	AiWorkflowBuilderMessage as AiWorkflowBuilderMessageDto,
	AiWorkflowBuilderSendMessageResponse,
	AiWorkflowBuilderWorkflowOutline,
} from '@n8n/api-types';
import { Service } from '@n8n/di';
import { WorkflowEntity, WorkflowRepository, type User } from '@n8n/db';
import { randomUUID } from 'node:crypto';
import type { IConnections, INode, IWorkflowSettings } from 'n8n-workflow';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { InternalServerError } from '@/errors/response-errors/internal-server.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';
import {
	AiWorkflowBuilderConversation,
	AiWorkflowBuilderConversationRepository,
	AiWorkflowBuilderDraft,
	AiWorkflowBuilderDraftRepository,
	AiWorkflowBuilderMessage,
	AiWorkflowBuilderMessageRepository,
} from '@/modules/workflow-builder';
import { WorkflowCreationService } from '@/workflows/workflow-creation.service';

import { AiWorkflowBuilderService } from './ai-workflow-builder.service';

const MAX_HISTORY_MESSAGES = 16;

@Service()
export class AiWorkflowBuilderConversationsService {
	constructor(
		private readonly conversationRepository: AiWorkflowBuilderConversationRepository,
		private readonly messageRepository: AiWorkflowBuilderMessageRepository,
		private readonly draftRepository: AiWorkflowBuilderDraftRepository,
		private readonly workflowRepository: WorkflowRepository,
		private readonly workflowCreationService: WorkflowCreationService,
		private readonly aiWorkflowBuilderService: AiWorkflowBuilderService,
	) {}

	async listConversations({
		projectId,
		userId,
		limit,
		offset,
	}: {
		projectId: string;
		userId: string;
		limit: number;
		offset: number;
	}): Promise<AiWorkflowBuilderListConversationsResponse> {
		const [conversations, total] = await this.conversationRepository.findUserConversations({
			projectId,
			userId,
			limit,
			offset,
		});

		return {
			conversations: conversations.map((conversation) => this.toConversationSummary(conversation)),
			total,
			limit,
			offset,
		};
	}

	async getConversation({
		conversationId,
		projectId,
		userId,
	}: {
		conversationId: string;
		projectId: string;
		userId: string;
	}): Promise<AiWorkflowBuilderConversationDetail> {
		const conversation = await this.getExistingConversation(conversationId, projectId, userId);
		return await this.toConversationDetail(conversation);
	}

	async createConversationWithMessage({
		projectId,
		user,
		clientMessageId,
		content,
	}: {
		projectId: string;
		user: User;
		clientMessageId: string;
		content: string;
	}): Promise<AiWorkflowBuilderSendMessageResponse> {
		const existing = await this.messageRepository.findOne({
			where: { id: clientMessageId },
		});
		if (existing) {
			const conversation = await this.getExistingConversation(
				existing.conversationId,
				projectId,
				user.id,
			);
			return await this.buildExistingSendResponse(conversation, existing);
		}

		const now = new Date();
		const conversation = await this.conversationRepository.manager.transaction(async (em) => {
			const conversationRepo = em.getRepository(AiWorkflowBuilderConversation);
			const messageRepo = em.getRepository(AiWorkflowBuilderMessage);
			const newConversation = conversationRepo.create({
				projectId,
				userId: user.id,
				title: this.createTitle(content),
				status: 'active',
				appliedWorkflowId: null,
				latestMessagePreview: this.createPreview(content),
				lastMessageAt: now,
				deletedAt: null,
			});
			const savedConversation = await conversationRepo.save(newConversation);
			await messageRepo.save(
				messageRepo.create({
					id: clientMessageId,
					conversationId: savedConversation.id,
					role: 'user',
					content,
					status: 'success',
					responseState: null,
					metadata: null,
				}),
			);
			return savedConversation;
		});

		return await this.generateAndPersistAssistantResponse(conversation, clientMessageId, content);
	}

	async sendMessage({
		conversationId,
		projectId,
		user,
		clientMessageId,
		content,
	}: {
		conversationId: string;
		projectId: string;
		user: User;
		clientMessageId: string;
		content: string;
	}): Promise<AiWorkflowBuilderSendMessageResponse> {
		const conversation = await this.getExistingConversation(conversationId, projectId, user.id);
		const existing = await this.messageRepository.findOne({ where: { id: clientMessageId } });
		if (existing) return await this.buildExistingSendResponse(conversation, existing);

		await this.messageRepository.manager.transaction(async (em) => {
			await em.save(
				AiWorkflowBuilderMessage,
				em.create(AiWorkflowBuilderMessage, {
					id: clientMessageId,
					conversationId,
					role: 'user',
					content,
					status: 'success',
					responseState: null,
					metadata: null,
				}),
			);
			await em.update(
				AiWorkflowBuilderConversation,
				{ id: conversationId },
				{
					latestMessagePreview: this.createPreview(content),
					lastMessageAt: new Date(),
				},
			);
		});

		return await this.generateAndPersistAssistantResponse(conversation, clientMessageId, content);
	}

	async retryAssistantResponse({
		conversationId,
		projectId,
		user,
		messageId,
	}: {
		conversationId: string;
		projectId: string;
		user: User;
		messageId: string;
	}): Promise<AiWorkflowBuilderSendMessageResponse> {
		const conversation = await this.getExistingConversation(conversationId, projectId, user.id);
		const failedAssistantMessage = await this.messageRepository.findOne({
			where: {
				id: messageId,
				conversationId,
				role: 'assistant',
				status: 'error',
			},
		});
		if (!failedAssistantMessage) throw new NotFoundError('Assistant message not found');

		const messages = await this.getMessages(conversationId);
		const userMessage = [...messages]
			.reverse()
			.find(
				(message) =>
					message.role === 'user' && message.createdAt <= failedAssistantMessage.createdAt,
			);
		if (!userMessage) throw new BadRequestError('Cannot retry without a user message');

		return await this.generateAndPersistAssistantResponse(
			conversation,
			userMessage.id,
			userMessage.content,
			failedAssistantMessage,
		);
	}

	async createDraftFromMessage({
		conversationId,
		projectId,
		userId,
		messageId,
	}: {
		conversationId: string;
		projectId: string;
		userId: string;
		messageId: string;
	}): Promise<AiWorkflowBuilderCreateDraftFromMessageResponse> {
		const conversation = await this.getExistingConversation(conversationId, projectId, userId);
		const message = await this.messageRepository.findOne({
			where: { id: messageId, conversationId, role: 'assistant' },
		});
		const outline = message?.metadata?.workflowOutline;
		if (!message || !outline) throw new NotFoundError('Suggested workflow not found');

		const existingDraftId = message.metadata?.draftId;
		const existingDraft = existingDraftId
			? await this.draftRepository.findOne({ where: { id: existingDraftId, conversationId } })
			: null;
		if (existingDraft && !this.isPlaceholderOutlineWorkflow(existingDraft.workflowJson)) {
			return {
				conversation: this.toConversationSummary(conversation),
				message: this.toMessageDto(message),
				draft: this.toDraftSummary(existingDraft),
			};
		}

		const workflow = this.createWorkflowFromOutline(outline, conversation.title);
		const draft =
			existingDraft ??
			this.draftRepository.create({
				id: randomUUID(),
				conversationId,
				messageId,
				workflowName: workflow.name,
				workflowJson: workflow,
				workflowOutline: outline,
				createdWorkflowId: null,
			});
		draft.messageId = messageId;
		draft.workflowName = workflow.name;
		draft.workflowJson = workflow;
		draft.workflowOutline = outline;
		draft.createdWorkflowId = null;
		message.metadata = { ...message.metadata, draftId: draft.id, workflowOutline: outline };

		await this.draftRepository.manager.transaction(async (em) => {
			await em.save(AiWorkflowBuilderDraft, draft);
			await em.save(AiWorkflowBuilderMessage, message);
		});

		return {
			conversation: this.toConversationSummary(conversation),
			message: this.toMessageDto(message),
			draft: this.toDraftSummary(draft),
		};
	}

	async renameConversation({
		conversationId,
		projectId,
		userId,
		title,
	}: {
		conversationId: string;
		projectId: string;
		userId: string;
		title: string;
	}) {
		const conversation = await this.getExistingConversation(conversationId, projectId, userId);
		conversation.title = title;
		return this.toConversationSummary(await this.conversationRepository.save(conversation));
	}

	async deleteConversation({
		conversationId,
		projectId,
		userId,
	}: {
		conversationId: string;
		projectId: string;
		userId: string;
	}) {
		const conversation = await this.getExistingConversation(conversationId, projectId, userId);
		conversation.status = 'archived';
		conversation.deletedAt = new Date();
		await this.conversationRepository.save(conversation);
		return { success: true };
	}

	async applyDraft({
		draftId,
		projectId,
		user,
	}: {
		draftId: string;
		projectId: string;
		user: User;
	}) {
		const draft = await this.draftRepository.findOne({
			where: { id: draftId },
			relations: { conversation: true },
		});
		if (!draft?.conversation || draft.conversation.projectId !== projectId) {
			throw new NotFoundError('Workflow draft not found');
		}
		const conversation = draft.conversation;
		if (conversation.userId !== user.id || conversation.deletedAt) {
			throw new NotFoundError('Workflow draft not found');
		}

		const workflow = new WorkflowEntity();
		workflow.name = draft.workflowJson.name;
		workflow.nodes = draft.workflowJson.nodes as unknown as INode[];
		workflow.connections = draft.workflowJson.connections as unknown as IConnections;
		workflow.settings = draft.workflowJson.settings as IWorkflowSettings;
		workflow.active = false;

		const createdWorkflow = await this.workflowCreationService.createWorkflow(user, workflow, {
			projectId,
			uiContext: 'ai-workflow-builder',
			source: 'ui',
		});

		draft.createdWorkflowId = createdWorkflow.id;
		conversation.appliedWorkflowId = createdWorkflow.id;
		conversation.status = 'generated';
		conversation.lastMessageAt = new Date();

		await this.draftRepository.manager.transaction(async (em) => {
			await em.save(AiWorkflowBuilderDraft, draft);
			await em.save(AiWorkflowBuilderConversation, conversation);
		});

		return {
			workflowId: createdWorkflow.id,
			conversation: this.toConversationSummary(conversation),
			draft: this.toDraftSummary(draft),
		};
	}

	private async generateAndPersistAssistantResponse(
		conversation: AiWorkflowBuilderConversation,
		userMessageId: string,
		content: string,
		existingFailedAssistantMessage?: AiWorkflowBuilderMessage,
	): Promise<AiWorkflowBuilderSendMessageResponse> {
		const assistantMessageId = existingFailedAssistantMessage?.id ?? randomUUID();
		const attemptCount = (existingFailedAssistantMessage?.metadata?.attemptCount ?? 0) + 1;

		try {
			const history = await this.getModelHistory(conversation.id, userMessageId);
			const currentWorkflow = conversation.appliedWorkflowId
				? await this.workflowRepository.findOne({
						where: { id: conversation.appliedWorkflowId },
						select: ['id', 'name', 'nodes', 'connections', 'settings'],
					})
				: undefined;
			const aiResponse = await this.aiWorkflowBuilderService.generateAssistantResponse({
				message: content,
				history,
				currentWorkflow,
			});

			let metadata: AiWorkflowBuilderAssistantMessageMetadata = {
				attemptCount,
				...(aiResponse.suggestedReplies ? { suggestedReplies: aiResponse.suggestedReplies } : {}),
				...(aiResponse.workflowOutline ? { workflowOutline: aiResponse.workflowOutline } : {}),
				...(aiResponse.missingInformation
					? { missingInformation: aiResponse.missingInformation }
					: {}),
			};
			const responseState = aiResponse.workflow ? 'generated' : aiResponse.state;
			let draft: AiWorkflowBuilderDraft | undefined;

			if (aiResponse.workflow) {
				const outline =
					aiResponse.workflowOutline ?? this.createOutlineFromWorkflow(aiResponse.workflow);
				const draftId = randomUUID();
				metadata = { ...metadata, draftId, workflowOutline: outline };
				draft = this.draftRepository.create({
					id: draftId,
					conversationId: conversation.id,
					messageId: assistantMessageId,
					workflowName: aiResponse.workflow.name,
					workflowJson: aiResponse.workflow,
					workflowOutline: outline,
					createdWorkflowId: null,
				});
			}

			const assistantMessage = this.messageRepository.create({
				id: assistantMessageId,
				conversationId: conversation.id,
				role: 'assistant',
				content: aiResponse.message,
				status: 'success',
				responseState,
				metadata,
			});

			await this.messageRepository.manager.transaction(async (em) => {
				await em.save(AiWorkflowBuilderMessage, assistantMessage);
				if (draft) await em.save(AiWorkflowBuilderDraft, draft);
				await em.update(
					AiWorkflowBuilderConversation,
					{ id: conversation.id },
					{
						latestMessagePreview: this.createPreview(aiResponse.message),
						lastMessageAt: new Date(),
					},
				);
			});

			return await this.buildSendResponse(conversation.id, userMessageId, assistantMessageId);
		} catch (error) {
			const assistantMessage = this.messageRepository.create({
				id: assistantMessageId,
				conversationId: conversation.id,
				role: 'assistant',
				content:
					error instanceof Error
						? error.message
						: 'Failed to generate a response. Please try again.',
				status: 'error',
				responseState: 'error',
				metadata: {
					attemptCount,
					errorCode: error instanceof InternalServerError ? 'generation_failed' : 'unknown_error',
				},
			});
			await this.messageRepository.save(assistantMessage);
			return await this.buildSendResponse(conversation.id, userMessageId, assistantMessageId);
		}
	}

	private async buildExistingSendResponse(
		conversation: AiWorkflowBuilderConversation,
		userMessage: AiWorkflowBuilderMessage,
	) {
		const assistantMessage = await this.messageRepository.findOne({
			where: { conversationId: conversation.id, role: 'assistant' },
			order: { createdAt: 'DESC' },
		});
		if (!assistantMessage) {
			throw new BadRequestError('Message is still waiting for an assistant response');
		}

		return {
			...(await this.toConversationDetail(conversation)),
			userMessage: this.toMessageDto(userMessage),
			assistantMessage: this.toMessageDto(assistantMessage),
		};
	}

	private async buildSendResponse(
		conversationId: string,
		userMessageId: string,
		assistantMessageId: string,
	): Promise<AiWorkflowBuilderSendMessageResponse> {
		const conversation = await this.conversationRepository.findOneByOrFail({ id: conversationId });
		const userMessage = await this.messageRepository.findOneByOrFail({ id: userMessageId });
		const assistantMessage = await this.messageRepository.findOneByOrFail({
			id: assistantMessageId,
		});

		return {
			...(await this.toConversationDetail(conversation)),
			userMessage: this.toMessageDto(userMessage),
			assistantMessage: this.toMessageDto(assistantMessage),
		};
	}

	private async toConversationDetail(
		conversation: AiWorkflowBuilderConversation,
	): Promise<AiWorkflowBuilderConversationDetail> {
		const [messages, drafts] = await Promise.all([
			this.getMessages(conversation.id),
			this.draftRepository.find({
				where: { conversationId: conversation.id },
				order: { createdAt: 'ASC' },
			}),
		]);

		return {
			conversation: this.toConversationSummary(conversation),
			messages: messages.map((message) => this.toMessageDto(message)),
			drafts: drafts.map((draft) => this.toDraftSummary(draft)),
		};
	}

	private async getExistingConversation(conversationId: string, projectId: string, userId: string) {
		const conversation = await this.conversationRepository.findUserConversation(
			conversationId,
			projectId,
			userId,
		);
		if (!conversation) throw new NotFoundError('Conversation not found');
		return conversation;
	}

	private async getMessages(conversationId: string) {
		return await this.messageRepository.find({
			where: { conversationId },
			order: { createdAt: 'ASC' },
		});
	}

	private async getModelHistory(conversationId: string, currentUserMessageId: string) {
		const messages = await this.getMessages(conversationId);
		const visibleMessages = messages.filter(
			(message) => message.id !== currentUserMessageId && message.status === 'success',
		);
		const firstUserMessage = visibleMessages.find((message) => message.role === 'user');
		const recentMessages = visibleMessages.slice(-MAX_HISTORY_MESSAGES);
		const selectedMessages =
			firstUserMessage && !recentMessages.some((message) => message.id === firstUserMessage.id)
				? [firstUserMessage, ...recentMessages]
				: recentMessages;

		return selectedMessages.map((message) => ({
			role: message.role,
			content: message.content,
		}));
	}

	private toConversationSummary(
		conversation: AiWorkflowBuilderConversation,
	): AiWorkflowBuilderConversationSummary {
		return {
			id: conversation.id,
			projectId: conversation.projectId,
			title: conversation.title,
			status: conversation.status,
			appliedWorkflowId: conversation.appliedWorkflowId,
			latestMessagePreview: conversation.latestMessagePreview,
			createdAt: conversation.createdAt.toISOString(),
			updatedAt: conversation.updatedAt.toISOString(),
			lastMessageAt: conversation.lastMessageAt.toISOString(),
		};
	}

	private toMessageDto(message: AiWorkflowBuilderMessage): AiWorkflowBuilderMessageDto {
		return {
			id: message.id,
			conversationId: message.conversationId,
			role: message.role,
			content: message.content,
			status: message.status,
			responseState: message.responseState,
			metadata: message.metadata,
			createdAt: message.createdAt.toISOString(),
			updatedAt: message.updatedAt.toISOString(),
		};
	}

	private toDraftSummary(draft: AiWorkflowBuilderDraft): AiWorkflowBuilderDraftSummary {
		return {
			id: draft.id,
			conversationId: draft.conversationId,
			messageId: draft.messageId,
			workflowName: draft.workflowName,
			workflowOutline: draft.workflowOutline,
			createdWorkflowId: draft.createdWorkflowId,
			createdAt: draft.createdAt.toISOString(),
			updatedAt: draft.updatedAt.toISOString(),
		};
	}

	private createTitle(content: string) {
		const words = content.trim().replace(/\s+/g, ' ').split(' ').slice(0, 8);
		const title = words.join(' ');
		return (title.length > 80 ? `${title.slice(0, 77)}...` : title) || 'New AI Builder chat';
	}

	private createPreview(content: string) {
		const preview = content.trim().replace(/\s+/g, ' ');
		return preview.length > 512 ? `${preview.slice(0, 509)}...` : preview;
	}

	private createOutlineFromWorkflow(
		workflow: AiWorkflowBuilderGeneratedWorkflow,
	): AiWorkflowBuilderWorkflowOutline {
		return {
			steps: workflow.nodes.slice(0, 20).map((node: Record<string, unknown>) => ({
				label: typeof node.name === 'string' ? node.name : 'Workflow step',
				nodeType: typeof node.type === 'string' ? node.type : undefined,
				description:
					typeof node.description === 'string'
						? node.description
						: `Runs ${typeof node.name === 'string' ? node.name : 'this workflow step'}.`,
			})),
		};
	}

	private createWorkflowFromOutline(
		outline: AiWorkflowBuilderWorkflowOutline,
		title: string,
	): AiWorkflowBuilderGeneratedWorkflow {
		const steps = outline.steps.length
			? outline.steps
			: [{ label: 'Workflow step', description: 'Runs this workflow step.' }];
		const nodes = steps.map((step, index) => this.createNodeFromOutlineStep(step, index));

		if (!this.isTriggerNode(nodes[0])) {
			nodes.unshift({
				id: randomUUID(),
				name: 'When clicking "Execute Workflow"',
				type: 'n8n-nodes-base.manualTrigger',
				typeVersion: 1,
				position: [240, 300],
				parameters: {},
				description: 'Starts the workflow manually for testing.',
			});
			nodes.forEach((node, index) => {
				node.position = [240 + index * 280, 300];
			});
		}

		const connections: AiWorkflowBuilderGeneratedWorkflow['connections'] = {};
		for (let index = 0; index < nodes.length - 1; index++) {
			connections[String(nodes[index].name)] = {
				main: [[{ node: String(nodes[index + 1].name), type: 'main', index: 0 }]],
			};
		}

		return {
			name: this.createWorkflowName(title),
			nodes,
			connections,
			settings: { executionOrder: 'v1' },
			active: false,
		};
	}

	private createNodeFromOutlineStep(
		step: AiWorkflowBuilderWorkflowOutline['steps'][number],
		index: number,
	): Record<string, unknown> {
		const text = `${step.label} ${step.description} ${step.nodeType ?? ''}`.toLowerCase();
		const base = {
			id: randomUUID(),
			name: this.createUniqueNodeName(step.label, index),
			typeVersion: 1,
			position: [240 + index * 280, 300],
			description: step.description,
		};

		if (step.nodeType?.startsWith('n8n-nodes-base.')) {
			return {
				...base,
				type: step.nodeType,
				parameters: this.createParametersForText(text),
			};
		}

		if (
			text.includes('schedule') ||
			text.includes('every morning') ||
			text.includes('daily') ||
			text.includes('recurring')
		) {
			return {
				...base,
				type: 'n8n-nodes-base.scheduleTrigger',
				typeVersion: 1.2,
				parameters: {
					rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] },
				},
			};
		}

		if (
			text.includes('webhook') ||
			text.includes('form') ||
			text.includes('submission') ||
			text.includes('receive')
		) {
			return {
				...base,
				type: 'n8n-nodes-base.webhook',
				parameters: {
					httpMethod: 'POST',
					path: this.createWebhookPath(step.label),
					responseMode: 'lastNode',
					options: {},
				},
				webhookId: randomUUID(),
			};
		}

		if (text.includes('slack')) {
			return {
				...base,
				type: 'n8n-nodes-base.slack',
				parameters: {
					authentication: 'accessToken',
					resource: 'message',
					operation: 'post',
					channel: '={{ $json.channel || "#general" }}',
					text: '={{ $json.summary || $json.message || JSON.stringify($json) }}',
					otherOptions: { mrkdwn: true },
					jsonParameters: false,
				},
			};
		}

		if (text.includes('fetch') || text.includes('retrieve') || text.includes('read')) {
			return {
				...base,
				type: 'n8n-nodes-base.httpRequest',
				typeVersion: 4.2,
				parameters: {
					method: 'GET',
					url: 'https://api.example.com/replace-me',
					sendHeaders: true,
					headerParameters: {
						parameters: [{ name: 'Authorization', value: 'Bearer REPLACE_ME' }],
					},
				},
			};
		}

		return {
			...base,
			type: 'n8n-nodes-base.code',
			typeVersion: 2,
			parameters: {
				jsCode: this.createCodeForText(text),
			},
		};
	}

	private createParametersForText(text: string): Record<string, unknown> {
		if (text.includes('http')) {
			return { method: 'GET', url: 'https://api.example.com/replace-me' };
		}

		return {};
	}

	private createCodeForText(text: string) {
		if (text.includes('summarize') || text.includes('summary')) {
			return (
				'const items = $input.all();\nreturn [{ json: { summary: `Summary for ' +
				'$' +
				'{items.length} item(s)`, items: items.map((item) => item.json) } }];'
			);
		}

		if (text.includes('format') || text.includes('normalize')) {
			return 'return $input.all().map((item) => ({ json: { ...item.json } }));';
		}

		return 'return $input.all();';
	}

	private isTriggerNode(node: Record<string, unknown> | undefined) {
		const type = typeof node?.type === 'string' ? node.type : '';
		return (
			type.includes('Trigger') || type.endsWith('.webhook') || type.endsWith('.scheduleTrigger')
		);
	}

	private createUniqueNodeName(label: string, index: number) {
		const cleaned = label.trim().replace(/\s+/g, ' ') || `Step ${index + 1}`;
		return index === 0 ? cleaned : `${index + 1}. ${cleaned}`;
	}

	private createWebhookPath(label: string) {
		const path = label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')
			.slice(0, 48);

		return path || 'ai-builder-webhook';
	}

	private createWorkflowName(title: string) {
		const cleaned = title.trim().replace(/\s+/g, ' ');
		return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned || 'AI Builder Workflow';
	}

	private isPlaceholderOutlineWorkflow(workflow: AiWorkflowBuilderGeneratedWorkflow) {
		const nodeTypes = workflow.nodes
			.map((node) => (typeof node.type === 'string' ? node.type : ''))
			.filter(Boolean);

		return (
			nodeTypes.includes('n8n-nodes-base.manualTrigger') &&
			nodeTypes.some((type) => type === 'n8n-nodes-base.noOp')
		);
	}
}
