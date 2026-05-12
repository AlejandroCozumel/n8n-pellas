<script setup lang="ts">
import { VIEWS } from '@/app/constants';
import { useDocumentTitle } from '@/app/composables/useDocumentTitle';
import { useTelemetry } from '@/app/composables/useTelemetry';
import { useToast } from '@/app/composables/useToast';
import { useProjectsStore } from '@/features/collaboration/projects/projects.store';
import {
	N8nButton,
	N8nHeading,
	N8nIcon,
	N8nIconButton,
	N8nInput,
	N8nMarkdown,
	N8nText,
} from '@n8n/design-system';
import { useI18n, type BaseTextKey } from '@n8n/i18n';
import type { AiWorkflowBuilderMessage } from '@n8n/api-types';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAiWorkflowBuilderStore } from '../aiWorkflowBuilder.store';

const i18n = useI18n();
const baseText = (key: string) => i18n.baseText(key as BaseTextKey);
const router = useRouter();
const route = useRoute();
const toast = useToast();
const telemetry = useTelemetry();
const documentTitle = useDocumentTitle();
const projectsStore = useProjectsStore();
const store = useAiWorkflowBuilderStore();

documentTitle.set(i18n.baseText('aiWorkflowBuilder.title'));

const messagesRef = ref<HTMLElement>();

const suggestedPrompts = computed(() => [
	baseText('aiWorkflowBuilder.suggestion.leadsToSlack'),
	baseText('aiWorkflowBuilder.suggestion.supportSummary'),
	baseText('aiWorkflowBuilder.suggestion.inactiveCustomers'),
]);

const projectId = computed(
	() => projectsStore.currentProjectId ?? projectsStore.personalProject?.id,
);

const activeConversationId = computed(() => store.activeConversation?.id);

watch(
	() => store.chatMessages.length,
	async () => {
		await nextTick();
		messagesRef.value?.scrollTo({ top: messagesRef.value.scrollHeight, behavior: 'smooth' });
	},
);

watch(activeConversationId, (conversationId) => {
	const query = { ...route.query };
	if (projectId.value) {
		query.projectId = projectId.value;
	}
	if (conversationId) {
		query.conversationId = conversationId;
	} else {
		delete query.conversationId;
	}
	void router.replace({ query });
});

watch(
	() => route.query.conversationId,
	(conversationId) => {
		if (!projectId.value) return;
		if (typeof conversationId === 'string') {
			if (conversationId !== store.activeConversation?.id) {
				void openConversationFromRoute(conversationId);
			}
			return;
		}

		if (store.activeConversation) {
			store.startNewChat();
		}
	},
);

onMounted(async () => {
	if (!projectsStore.personalProject) {
		await projectsStore.getPersonalProject();
	}
	if (!projectId.value) return;

	await store.loadHistory(projectId.value);

	const conversationId = route.query.conversationId;
	if (typeof conversationId === 'string') {
		await openConversationFromRoute(conversationId);
	}
});

async function openConversationFromRoute(conversationId: string) {
	if (!projectId.value) return;
	try {
		await store.openConversation(projectId.value, conversationId);
		telemetry.track('AI Builder conversation resumed', {
			workflow_builder_conversation_id: conversationId,
		});
	} catch {
		store.startNewChat();
		const query = { ...route.query };
		delete query.conversationId;
		void router.replace({ query });
		toast.showMessage({
			title: baseText('aiWorkflowBuilder.conversation.unavailable'),
			type: 'warning',
		});
	}
}

async function onSubmit() {
	if (!store.prompt.trim() || store.loading || !projectId.value) return;
	const wasNew = !store.activeConversation;
	await store.sendMessage(projectId.value);
	const assistantMessage = getLatestAssistantMessage();
	telemetry.track(wasNew ? 'AI Builder chat started' : 'AI Builder message sent', {
		workflow_builder_conversation_id: store.activeConversation?.id,
		conversation_length: store.chatMessages.length,
		clarification_turns: getClarificationTurnCount(),
		workflow_generated: assistantMessage?.responseState === 'generated',
		error_type: assistantMessage?.metadata?.errorCode,
	});
	trackAssistantResponse(assistantMessage);
}

function onKeydown(e: KeyboardEvent) {
	if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
		void onSubmit();
	}
}

function selectSuggestion(text: string) {
	store.prompt = text;
}

async function onApplyDraft(draftId: string) {
	if (!projectId.value) return;
	try {
		const workflowId = await store.applyWorkflowDraft(projectId.value, draftId);
		if (!workflowId) return;
		telemetry.track('AI Builder workflow applied', {
			workflow_builder_conversation_id: store.activeConversation?.id,
		});
		toast.showMessage({
			title: i18n.baseText('aiWorkflowBuilder.success.created'),
			type: 'success',
		});
		await router.push({ name: VIEWS.WORKFLOW, params: { workflowId } });
	} catch (err) {
		toast.showError(
			err instanceof Error ? err : new Error(String(err)),
			i18n.baseText('aiWorkflowBuilder.error.create'),
		);
	}
}

async function onCreateFromMessage(message: AiWorkflowBuilderMessage) {
	if (!projectId.value) return;
	try {
		const draft = await store.createDraftFromMessage(projectId.value, message.id);
		if (draft) await onApplyDraft(draft.id);
	} catch (err) {
		toast.showError(
			err instanceof Error ? err : new Error(String(err)),
			i18n.baseText('aiWorkflowBuilder.error.create'),
		);
	}
}

function getDraftForMessage(message: AiWorkflowBuilderMessage) {
	const draftId = message.metadata?.draftId;
	return draftId ? store.drafts.find((draft) => draft.id === draftId) : undefined;
}

async function openWorkflow(workflowId: string) {
	await router.push({ name: VIEWS.WORKFLOW, params: { workflowId } });
}

function getLatestAssistantMessage() {
	for (let index = store.chatMessages.length - 1; index >= 0; index--) {
		const message = store.chatMessages[index];
		if (message.role === 'assistant') return message;
	}
	return undefined;
}

function getClarificationTurnCount() {
	return store.chatMessages.filter((message) => message.responseState === 'needs_clarification')
		.length;
}

function trackAssistantResponse(message: AiWorkflowBuilderMessage | undefined) {
	if (!message) return;
	const properties = {
		workflow_builder_conversation_id: store.activeConversation?.id,
		conversation_length: store.chatMessages.length,
		clarification_turns: getClarificationTurnCount(),
		error_type: message.metadata?.errorCode,
	};
	if (message.responseState === 'needs_clarification') {
		telemetry.track('AI Builder clarification asked', properties);
	} else if (message.responseState === 'generated') {
		telemetry.track('AI Builder workflow generated', properties);
	} else if (message.responseState === 'partial' || message.responseState === 'unsupported') {
		telemetry.track('AI Builder fallback response shown', properties);
	} else if (message.responseState === 'error' || message.status === 'error') {
		telemetry.track('AI Builder failed to answer', properties);
	}
}
</script>

<template>
	<div :class="$style.container">
		<main :class="$style.chat">
			<div v-if="store.chatMessages.length === 0" :class="$style.greeting">
				<div :class="$style.greetingIcon">
					<N8nIcon icon="sparkles" size="xlarge" color="primary" />
				</div>
				<N8nHeading tag="h1" size="2xlarge" :class="$style.greetingTitle">
					{{ i18n.baseText('aiWorkflowBuilder.title') }}
				</N8nHeading>
				<N8nText color="text-base" :class="$style.greetingSubtitle">
					{{ i18n.baseText('aiWorkflowBuilder.description') }}
				</N8nText>
				<div :class="$style.suggestions">
					<button
						v-for="suggestion in suggestedPrompts"
						:key="suggestion"
						:class="$style.suggestionChip"
						@click="selectSuggestion(suggestion)"
					>
						{{ suggestion }}
					</button>
				</div>
			</div>

			<div v-else ref="messagesRef" :class="$style.messageList">
				<div :class="$style.conversationColumn">
					<div
						v-for="msg in store.chatMessages"
						:key="msg.id"
						:class="msg.role === 'user' ? $style.userRow : $style.aiRow"
					>
						<div v-if="msg.role === 'user'" :class="$style.userBubble">{{ msg.content }}</div>
						<template v-else>
							<div :class="$style.aiAvatar">
								<N8nIcon icon="sparkles" size="medium" />
							</div>
							<div :class="$style.aiContent">
								<div :class="[msg.status === 'error' ? $style.errorCard : $style.aiBubble]">
									<N8nMarkdown v-if="msg.status !== 'error'" :content="msg.content" />
									<N8nText v-else>{{ msg.content }}</N8nText>
								</div>

								<div v-if="msg.metadata?.suggestedReplies?.length" :class="$style.quickReplies">
									<N8nButton
										v-for="reply in msg.metadata.suggestedReplies"
										:key="reply"
										type="secondary"
										size="small"
										:label="reply"
										@click="
											selectSuggestion(reply);
											onSubmit();
										"
									/>
								</div>

								<div v-if="msg.metadata?.workflowOutline" :class="$style.workflowCard">
									<N8nText bold size="medium">
										{{
											getDraftForMessage(msg)?.workflowName ??
											baseText('aiWorkflowBuilder.workflowOutline.title')
										}}
									</N8nText>
									<div
										v-if="getDraftForMessage(msg)?.createdWorkflowId"
										:class="$style.createdStatus"
									>
										<N8nIcon icon="circle-check" size="small" color="success" />
										<N8nText size="small" bold color="success">
											{{ baseText('aiWorkflowBuilder.workflowCreated') }}
										</N8nText>
									</div>
									<ul :class="$style.nodeList">
										<li
											v-for="(step, index) in msg.metadata.workflowOutline.steps"
											:key="`${msg.id}-${index}`"
											:class="$style.nodeItem"
										>
											<span :class="$style.stepBadge">{{ index + 1 }}</span>
											<div :class="$style.nodeText">
												<N8nText bold>{{ step.label }}</N8nText>
												<N8nText color="text-light" size="small">{{ step.description }}</N8nText>
											</div>
										</li>
									</ul>
									<N8nButton
										v-if="getDraftForMessage(msg)?.createdWorkflowId"
										:label="baseText('aiWorkflowBuilder.openWorkflow')"
										type="secondary"
										size="small"
										icon="external-link"
										data-testid="ai-workflow-builder-open-workflow"
										@click="openWorkflow(getDraftForMessage(msg)!.createdWorkflowId!)"
									/>
									<N8nButton
										:label="
											store.activeConversation?.appliedWorkflowId
												? baseText('aiWorkflowBuilder.createNewFromDraft.button')
												: i18n.baseText('aiWorkflowBuilder.create.button')
										"
										type="primary"
										size="small"
										:loading="
											store.applyingDraftId === getDraftForMessage(msg)?.id ||
											store.creatingDraftMessageId === msg.id
										"
										:disabled="store.loading"
										data-testid="ai-workflow-builder-create"
										@click="onCreateFromMessage(msg)"
									/>
								</div>

								<N8nButton
									v-if="msg.status === 'error'"
									type="secondary"
									size="small"
									:label="baseText('aiWorkflowBuilder.retry')"
									@click="projectId && store.retryMessage(projectId, msg.id)"
								/>
							</div>
						</template>
					</div>

					<div v-if="store.loading" :class="$style.aiRow">
						<div :class="[$style.aiAvatar, $style.aiAvatarThinking]">
							<N8nIcon icon="sparkles" size="medium" />
						</div>
						<div :class="$style.thinkingDots"><span /><span /><span /></div>
					</div>
				</div>
			</div>

			<div :class="$style.promptWrapper">
				<div :class="$style.promptInner">
					<div :class="$style.promptBox">
						<N8nInput
							v-model="store.prompt"
							type="textarea"
							:autosize="{ minRows: 1, maxRows: 6 }"
							:placeholder="i18n.baseText('aiWorkflowBuilder.prompt.placeholder')"
							:disabled="store.loading || !projectId"
							data-testid="ai-workflow-builder-prompt"
							@keydown="onKeydown"
						/>
						<N8nIconButton
							icon="arrow-up"
							:disabled="store.loading || store.prompt.trim().length === 0 || !projectId"
							:loading="store.loading"
							:class="$style.sendButton"
							data-testid="ai-workflow-builder-generate"
							@click="onSubmit"
						/>
					</div>
					<N8nText size="xsmall" color="text-light" :class="$style.hint">
						{{ i18n.baseText('aiWorkflowBuilder.prompt.hint') }}
					</N8nText>
				</div>
			</div>
		</main>
	</div>
</template>

<style module lang="scss">
.container {
	display: flex;
	height: 100%;
	background: var(--color--background--light-2);
	overflow: hidden;
}

.chat {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
}

.greeting {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--spacing--sm);
	padding: var(--spacing--2xl) var(--spacing--lg);
	text-align: center;
}

.greetingIcon {
	width: 3.5rem;
	height: 3.5rem;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--color--primary-tint-3);
	border-radius: 50%;
	margin-bottom: var(--spacing--2xs);
}

.greetingTitle {
	color: var(--color--text--shade-1);
}

.greetingSubtitle {
	max-width: 32rem;
	color: var(--color--text--tint-1);
}

.suggestions,
.quickReplies {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: var(--spacing--3xs);
	margin-top: var(--spacing--sm);
	max-width: 40rem;
}

.suggestionChip {
	padding: var(--spacing--3xs) var(--spacing--xs);
	background: var(--color--background--surface);
	border: var(--border-base);
	border-radius: var(--border-radius-base);
	color: var(--color--text--shade-1);
	font-size: var(--font-size--sm);
	cursor: pointer;
}

.suggestionChip:hover {
	background: var(--color--background--light);
}

.messageList {
	flex: 1;
	overflow-y: auto;
	padding: var(--spacing--lg);
}

.conversationColumn {
	width: 100%;
	max-width: 56rem;
	margin: 0 auto;
}

.userRow {
	display: flex;
	justify-content: flex-end;
	margin-bottom: var(--spacing--md);
	width: 100%;
}

.userBubble {
	max-width: min(42rem, 80%);
	background: var(--color--background--surface);
	border: var(--border-base);
	color: var(--color--text--dark);
	border-radius: var(--border-radius-base);
	padding: var(--spacing--xs) var(--spacing--sm);
	white-space: pre-wrap;
}

.aiRow {
	display: flex;
	gap: var(--spacing--xs);
	margin-bottom: var(--spacing--md);
	width: 100%;
}

.aiAvatar {
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 50%;
	background: var(--color--primary-tint-3);
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	color: var(--color--primary);
}

.aiAvatarThinking {
	animation: thinking-pulse 1.4s ease-in-out infinite;
	box-shadow: 0 0 0 0 color-mix(in srgb, var(--color--primary) 35%, transparent);
}

.aiContent {
	width: 100%;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}

.aiBubble,
.workflowCard,
.errorCard {
	background: var(--color--background--surface);
	border: var(--border-base);
	border-radius: var(--border-radius-base);
	padding: var(--spacing--sm);
}

.errorCard {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
	color: var(--color--danger);
}

.workflowName {
	display: block;
	margin-bottom: var(--spacing--xs);
}

.createdStatus {
	display: flex;
	align-items: center;
	gap: var(--spacing--4xs);
	margin-top: var(--spacing--2xs);
}

.nodeList {
	list-style: none;
	padding: 0;
	margin: var(--spacing--xs) 0;
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}

.nodeItem {
	display: flex;
	gap: var(--spacing--2xs);
	align-items: flex-start;
}

.stepBadge {
	min-width: 1.5rem;
	height: 1.5rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: var(--border-radius-base);
	background: var(--color--background--light);
	color: var(--color--text--base);
	font-size: var(--font-size--2xs);
	font-weight: var(--font-weight-bold);
}

.nodeText {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--5xs);
}

.promptWrapper {
	flex-shrink: 0;
	padding: var(--spacing--sm) var(--spacing--lg);
	background: var(--color--background--light-2);
	border-top: var(--border-base);
}

.promptInner {
	width: 100%;
	max-width: 56rem;
	margin: 0 auto;
}

.promptBox {
	display: flex;
	gap: var(--spacing--2xs);
	align-items: flex-end;
	background: var(--color--background--surface);
	border: var(--border-base);
	border-radius: var(--border-radius-base);
	padding: var(--spacing--2xs);
}

.promptBox :global(.el-textarea__inner) {
	border: none;
	box-shadow: none;
	resize: none;
}

.promptBox :global(.el-textarea) {
	flex: 1;
	min-width: 0;
}

.sendButton {
	flex-shrink: 0;
}

.hint {
	display: block;
	text-align: center;
	margin-top: var(--spacing--2xs);
}

.thinkingDots {
	display: flex;
	gap: var(--spacing--4xs);
	padding: var(--spacing--sm);
	background: var(--color--background--surface);
	border: var(--border-base);
	border-radius: var(--border-radius-base);
}

.thinkingDots span {
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: var(--color--text--light);
	animation: pulse 1.4s infinite ease-in-out;
}

.thinkingDots span:nth-child(2) {
	animation-delay: 0.2s;
}

.thinkingDots span:nth-child(3) {
	animation-delay: 0.4s;
}

@keyframes pulse {
	0%,
	80%,
	100% {
		opacity: 0.3;
	}
	40% {
		opacity: 1;
	}
}

@keyframes thinking-pulse {
	0% {
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--color--primary) 35%, transparent);
		transform: scale(1);
	}
	50% {
		box-shadow: 0 0 0 0.5rem transparent;
		transform: scale(1.06);
	}
	100% {
		box-shadow: 0 0 0 0 transparent;
		transform: scale(1);
	}
}

@media (max-width: 48rem) {
	.messageList {
		padding: var(--spacing--sm);
	}

	.userBubble,
	.aiContent {
		max-width: 100%;
	}
}
</style>
