<script lang="ts" setup>
import BaseLayout from './BaseLayout.vue';
import AiWorkflowBuilderSidebar from '@/features/aiWorkflowBuilder/components/AiWorkflowBuilderSidebar.vue';
</script>

<template>
	<BaseLayout>
		<template #sidebar>
			<AiWorkflowBuilderSidebar />
		</template>
		<RouterView />
	</BaseLayout>
</template>
