import type {
	AiWorkflowBuilderConversationSummary,
	AiWorkflowBuilderDraftSummary,
	AiWorkflowBuilderMessage,
} from '@n8n/api-types';
import { STORES } from '@n8n/stores';
import { useRootStore } from '@n8n/stores/useRootStore';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
	applyDraft,
	createConversation,
	createDraftFromMessage as createDraftFromMessageApi,
	deleteConversation,
	getConversation,
	listConversations,
	renameConversation as renameConversationApi,
	retryConversationMessage,
	sendConversationMessage,
} from './aiWorkflowBuilder.api';

export const useAiWorkflowBuilderStore = defineStore(STORES.AI_WORKFLOW_BUILDER, () => {
	const rootStore = useRootStore();

	const prompt = ref('');
	const loading = ref(false);

	const conversations = ref<AiWorkflowBuilderConversationSummary[]>([]);
	const activeConversation = ref<AiWorkflowBuilderConversationSummary | null>(null);
	const chatMessages = ref<AiWorkflowBuilderMessage[]>([]);
	const drafts = ref<AiWorkflowBuilderDraftSummary[]>([]);
	const historyLoading = ref(false);
	const conversationLoading = ref(false);
	const applyingDraftId = ref<string | null>(null);
	const creatingDraftMessageId = ref<string | null>(null);

	const hasActiveConversation = computed(() => activeConversation.value !== null);

	async function loadHistory(projectId: string) {
		historyLoading.value = true;
		try {
			const response = await listConversations(rootStore.restApiContext, projectId);
			conversations.value = response.conversations;
		} finally {
			historyLoading.value = false;
		}
	}

	async function openConversation(projectId: string, conversationId: string) {
		conversationLoading.value = true;
		try {
			const response = await getConversation(rootStore.restApiContext, projectId, conversationId);
			activeConversation.value = response.conversation;
			chatMessages.value = response.messages;
			drafts.value = response.drafts;
			upsertConversation(response.conversation);
		} finally {
			conversationLoading.value = false;
		}
	}

	function startNewChat() {
		activeConversation.value = null;
		chatMessages.value = [];
		drafts.value = [];
		prompt.value = '';
		loading.value = false;
	}

	async function sendMessage(projectId: string) {
		const text = prompt.value.trim();
		if (!text || loading.value) return;

		const clientMessageId = crypto.randomUUID();
		const localConversationId = activeConversation.value?.id ?? 'local';
		chatMessages.value.push({
			id: clientMessageId,
			conversationId: localConversationId,
			role: 'user',
			content: text,
			status: 'pending',
			responseState: null,
			metadata: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		prompt.value = '';
		loading.value = true;

		try {
			const response = activeConversation.value
				? await sendConversationMessage(
						rootStore.restApiContext,
						projectId,
						activeConversation.value.id,
						{ clientMessageId, content: text },
					)
				: await createConversation(rootStore.restApiContext, projectId, {
						clientMessageId,
						content: text,
					});

			activeConversation.value = response.conversation;
			chatMessages.value = response.messages;
			drafts.value = response.drafts;
			upsertConversation(response.conversation);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to send message.';
			chatMessages.value = chatMessages.value.map((message) =>
				message.id === clientMessageId ? { ...message, status: 'success' } : message,
			);
			chatMessages.value.push({
				id: crypto.randomUUID(),
				conversationId: localConversationId,
				role: 'assistant',
				content: errorMessage,
				status: 'error',
				responseState: 'error',
				metadata: { attemptCount: 1, errorCode: 'send_failed' },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		} finally {
			loading.value = false;
		}
	}

	async function retryMessage(projectId: string, messageId: string) {
		if (!activeConversation.value || loading.value) return;
		loading.value = true;
		try {
			const response = await retryConversationMessage(
				rootStore.restApiContext,
				projectId,
				activeConversation.value.id,
				messageId,
			);
			activeConversation.value = response.conversation;
			chatMessages.value = response.messages;
			drafts.value = response.drafts;
			upsertConversation(response.conversation);
		} finally {
			loading.value = false;
		}
	}

	async function createDraftFromMessage(projectId: string, messageId: string) {
		if (!activeConversation.value) return;
		creatingDraftMessageId.value = messageId;
		try {
			const response = await createDraftFromMessageApi(
				rootStore.restApiContext,
				projectId,
				activeConversation.value.id,
				messageId,
			);
			activeConversation.value = response.conversation;
			upsertConversation(response.conversation);
			drafts.value = [
				...drafts.value.filter((draft) => draft.id !== response.draft.id),
				response.draft,
			];
			chatMessages.value = chatMessages.value.map((message) =>
				message.id === response.message.id ? response.message : message,
			);
			return response.draft;
		} finally {
			creatingDraftMessageId.value = null;
		}
	}

	async function renameConversation(projectId: string, conversationId: string, title: string) {
		const updated = await renameConversationApi(
			rootStore.restApiContext,
			projectId,
			conversationId,
			title,
		);
		if (activeConversation.value?.id === conversationId) {
			activeConversation.value = updated;
		}
		upsertConversation(updated);
	}

	async function deleteActiveConversation(projectId: string, conversationId: string) {
		await deleteConversation(rootStore.restApiContext, projectId, conversationId);
		conversations.value = conversations.value.filter(
			(conversation) => conversation.id !== conversationId,
		);
		if (activeConversation.value?.id === conversationId) {
			startNewChat();
		}
	}

	async function applyWorkflowDraft(projectId: string, draftId: string) {
		applyingDraftId.value = draftId;
		try {
			const response = await applyDraft(rootStore.restApiContext, projectId, draftId);
			activeConversation.value = response.conversation;
			upsertConversation(response.conversation);
			drafts.value = drafts.value.map((draft) => (draft.id === draftId ? response.draft : draft));
			return response.workflowId;
		} finally {
			applyingDraftId.value = null;
		}
	}

	function upsertConversation(conversation: AiWorkflowBuilderConversationSummary) {
		const existingIndex = conversations.value.findIndex((item) => item.id === conversation.id);
		if (existingIndex === -1) {
			conversations.value = [conversation, ...conversations.value];
			return;
		}
		conversations.value.splice(existingIndex, 1, conversation);
		conversations.value = [...conversations.value].sort(
			(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
	}

	return {
		prompt,
		loading,
		conversations,
		activeConversation,
		chatMessages,
		drafts,
		historyLoading,
		conversationLoading,
		applyingDraftId,
		creatingDraftMessageId,
		hasActiveConversation,
		loadHistory,
		openConversation,
		startNewChat,
		sendMessage,
		retryMessage,
		createDraftFromMessage,
		renameConversation,
		deleteActiveConversation,
		applyWorkflowDraft,
	};
});
