<script lang="ts" setup>
import BottomMenu from '@/app/components/BottomMenu.vue';
import MainSidebarHeader from '@/app/components/MainSidebarHeader.vue';
import { useKeybindings } from '@/app/composables/useKeybindings';
import { useMessage } from '@/app/composables/useMessage';
import { useSettingsItems } from '@/app/composables/useSettingsItems';
import { useSidebarLayout } from '@/app/composables/useSidebarLayout';
import { useTelemetry } from '@/app/composables/useTelemetry';
import { useToast } from '@/app/composables/useToast';
import { MODAL_CONFIRM, VIEWS } from '@/app/constants';
import { useProjectsStore } from '@/features/collaboration/projects/projects.store';
import ChatSidebarLink from '@/features/ai/chatHub/components/ChatSidebarLink.vue';
import { getRelativeDate } from '@/features/ai/chatHub/chat.utils';
import {
	type IMenuItem,
	N8nInput,
	N8nMenuItem,
	N8nResizeWrapper,
	N8nScrollArea,
	N8nText,
} from '@n8n/design-system';
import type { ActionDropdownItem } from '@n8n/design-system/types';
import { useI18n } from '@n8n/i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAiWorkflowBuilderStore } from '../aiWorkflowBuilder.store';

type ConversationAction = 'rename' | 'delete';

const i18n = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const message = useMessage();
const telemetry = useTelemetry();
const projectsStore = useProjectsStore();
const store = useAiWorkflowBuilderStore();

const {
	isCollapsed,
	isResizing,
	sidebarWidth,
	onResizeStart,
	onResize,
	onResizeEnd,
	toggleCollapse,
} = useSidebarLayout();

const { settingsItems } = useSettingsItems();

const renamingConversationId = ref<string>();
const editedTitle = ref('');

const projectId = computed(
	() => projectsStore.currentProjectId ?? projectsStore.personalProject?.id,
);
const activeConversationId = computed(() =>
	typeof route.query.conversationId === 'string' ? route.query.conversationId : undefined,
);

const newChat = computed<IMenuItem>(() => ({
	id: 'new-chat',
	label: i18n.baseText('aiWorkflowBuilder.newChat'),
	icon: 'plus',
	route: { to: { name: VIEWS.AI_WORKFLOW_BUILDER } },
}));

const visibleMenuItems = computed<IMenuItem[]>(() => [
	{
		id: 'settings',
		label: i18n.baseText('mainSidebar.settings'),
		icon: 'settings',
		available: true,
		children: settingsItems.value,
	},
]);

const conversationActions = computed<Array<ActionDropdownItem<ConversationAction>>>(() => [
	{
		id: 'rename',
		label: i18n.baseText('aiWorkflowBuilder.rename'),
		icon: 'pencil',
	},
	{
		id: 'delete',
		label: i18n.baseText('aiWorkflowBuilder.delete'),
		icon: 'trash-2',
	},
]);

const groupedConversations = computed(() => {
	const now = new Date();
	const groups = new Map<string, typeof store.conversations>();

	for (const conversation of store.conversations) {
		const group = getRelativeDate(now, conversation.lastMessageAt ?? conversation.updatedAt);
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group)!.push(conversation);
	}

	return ['Today', 'Yesterday', 'This week', 'Older'].flatMap((group) => {
		const conversations = groups.get(group) ?? [];
		return conversations.length
			? [
					{
						group,
						label: getGroupLabel(group),
						conversations: conversations.toSorted(
							(a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
						),
					},
				]
			: [];
	});
});

function getGroupLabel(group: string) {
	if (group === 'Today') return i18n.baseText('aiWorkflowBuilder.history.group.today');
	if (group === 'Yesterday') return i18n.baseText('aiWorkflowBuilder.history.group.yesterday');
	if (group === 'This week') return i18n.baseText('aiWorkflowBuilder.history.group.thisWeek');
	return i18n.baseText('aiWorkflowBuilder.history.group.older');
}

function openCommandBar(event: MouseEvent) {
	event.stopPropagation();

	void nextTick(() => {
		const keyboardEvent = new KeyboardEvent('keydown', {
			key: 'k',
			code: 'KeyK',
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(keyboardEvent);
	});
}

async function loadHistory() {
	if (!projectsStore.personalProject) {
		await projectsStore.getPersonalProject();
	}
	if (!projectId.value) return;
	await store.loadHistory(projectId.value);
}

function handleNewChatClick() {
	store.startNewChat();
	telemetry.track('AI Builder new chat clicked');
	void router.push({
		name: VIEWS.AI_WORKFLOW_BUILDER,
		query: projectId.value ? { projectId: projectId.value } : {},
	});
}

function startRename(conversationId: string, currentTitle: string) {
	renamingConversationId.value = conversationId;
	editedTitle.value = currentTitle;
}

function cancelRename() {
	renamingConversationId.value = undefined;
	editedTitle.value = '';
}

async function confirmRename(conversationId: string) {
	if (!projectId.value) return;
	const title = editedTitle.value.trim();
	if (!title) {
		cancelRename();
		return;
	}

	try {
		await store.renameConversation(projectId.value, conversationId, title);
		cancelRename();
	} catch (error) {
		toast.showError(error, i18n.baseText('chatHub.session.updateTitle.error'));
	}
}

async function deleteConversation(conversationId: string) {
	if (!projectId.value) return;
	const confirmed = await message.confirm(
		i18n.baseText('aiWorkflowBuilder.delete.confirm.message'),
		i18n.baseText('aiWorkflowBuilder.delete.confirm.title'),
		{
			confirmButtonText: i18n.baseText('generic.delete'),
			cancelButtonText: i18n.baseText('generic.cancel'),
		},
	);

	if (confirmed !== MODAL_CONFIRM) return;

	await store.deleteActiveConversation(projectId.value, conversationId);
	telemetry.track('AI Builder conversation deleted', {
		workflow_builder_conversation_id: conversationId,
	});

	if (activeConversationId.value === conversationId) {
		await router.push({
			name: VIEWS.AI_WORKFLOW_BUILDER,
			query: projectId.value ? { projectId: projectId.value } : {},
		});
	}
}

function handleAction(action: ConversationAction, conversationId: string) {
	const conversation = store.conversations.find((item) => item.id === conversationId);
	if (!conversation) return;

	if (action === 'rename') {
		startRename(conversationId, conversation.title);
	} else {
		void deleteConversation(conversationId);
	}
}

function getConversationLabel(status: string) {
	return status === 'generated'
		? i18n.baseText('aiWorkflowBuilder.workflowCreated')
		: i18n.baseText('aiWorkflowBuilder.sidebar.conversationLabel');
}

const onLogout = () => {
	void router.push({ name: VIEWS.SIGNOUT });
};

watch(projectId, (id) => {
	if (id) void store.loadHistory(id);
});

useKeybindings({
	['bracketleft']: () => toggleCollapse(),
});

onMounted(() => {
	void loadHistory();
});
</script>

<template>
	<N8nResizeWrapper
		id="side-menu"
		:class="{
			[$style.sideMenu]: true,
			[$style.sideMenuCollapsed]: isCollapsed,
			[$style.sideMenuResizing]: isResizing,
		}"
		:width="sidebarWidth"
		:style="isCollapsed ? {} : { width: `${sidebarWidth}px` }"
		:supported-directions="['right']"
		:min-width="240"
		:max-width="500"
		:grid-size="8"
		@resizestart="onResizeStart"
		@resize="onResize"
		@resizeend="onResizeEnd"
	>
		<MainSidebarHeader
			hide-create
			:is-collapsed="isCollapsed"
			@collapse="toggleCollapse"
			@open-command-bar="openCommandBar"
		/>
		<N8nScrollArea as-child>
			<div :class="$style.scrollArea">
				<div :class="[$style.links, { [$style.collapsed]: isCollapsed }]">
					<N8nMenuItem
						:item="newChat"
						:compact="isCollapsed"
						:active="!activeConversationId"
						data-test-id="ai-workflow-builder-new-chat"
						@click="handleNewChatClick"
					/>
				</div>

				<N8nScrollArea as-child type="scroll">
					<div :class="[$style.historySections, { [$style.collapsed]: isCollapsed }]">
						<div v-if="store.historyLoading" :class="$style.group">
							<N8nText v-if="!isCollapsed" color="text-light" size="small">
								{{ i18n.baseText('aiWorkflowBuilder.history.loading') }}
							</N8nText>
						</div>
						<div v-else-if="store.conversations.length === 0" :class="$style.group">
							<N8nText v-if="!isCollapsed" color="text-light" size="small">
								{{ i18n.baseText('aiWorkflowBuilder.history.empty') }}
							</N8nText>
						</div>
						<div
							v-for="group in groupedConversations"
							v-else
							:key="group.group"
							:class="$style.group"
						>
							<N8nText
								v-if="!isCollapsed"
								:class="$style.groupHeader"
								size="small"
								bold
								color="text-light"
							>
								{{ group.label }}
							</N8nText>
							<div
								v-for="conversation in group.conversations"
								:key="conversation.id"
								:class="$style.conversationItem"
							>
								<N8nInput
									v-if="renamingConversationId === conversation.id"
									v-model="editedTitle"
									size="large"
									@blur="confirmRename(conversation.id)"
									@keydown.enter="confirmRename(conversation.id)"
									@keydown.esc="cancelRename"
								/>
								<ChatSidebarLink
									v-else
									:to="{
										name: VIEWS.AI_WORKFLOW_BUILDER,
										query: {
											projectId: conversation.projectId,
											conversationId: conversation.id,
										},
									}"
									icon="sparkles"
									:compact="isCollapsed"
									:active="activeConversationId === conversation.id"
									:menu-items="conversationActions"
									:label="getConversationLabel(conversation.status)"
									:title="conversation.title"
									@action-select="handleAction($event, conversation.id)"
								/>
							</div>
						</div>
					</div>
				</N8nScrollArea>

				<BottomMenu :items="visibleMenuItems" :is-collapsed="isCollapsed" @logout="onLogout" />
			</div>
		</N8nScrollArea>
	</N8nResizeWrapper>
</template>

<style lang="scss" module>
.sideMenu {
	position: relative;
	height: 100%;
	display: flex;
	flex-direction: column;
	border-right: var(--border);
	background-color: var(--menu--color--background, var(--color--background--light-2));
	transition: width var(--duration--snappy) var(--easing--ease-out);
	will-change: width;

	&.sideMenuCollapsed {
		width: $sidebar-width;
		min-width: auto;
	}

	&.sideMenuResizing {
		transition: none;
	}
}

.scrollArea {
	height: 100%;
	display: flex;
	flex-direction: column;
}

.links {
	display: flex;
	flex-direction: column;
	padding: var(--spacing--2xs) var(--spacing--3xs);

	&.collapsed {
		border-bottom: var(--border);
	}
}

.historySections {
	display: flex;
	flex: 1;
	flex-direction: column;
	padding: var(--spacing--2xs) var(--spacing--3xs);
	gap: var(--spacing--sm);

	&.collapsed {
		gap: 0;
	}
}

.group {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.groupHeader {
	padding: 0 var(--spacing--4xs) var(--spacing--3xs);
}

.conversationItem {
	min-width: 0;
}
</style>
