import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';

@BackendModule({ name: 'workflow-builder', instanceTypes: ['main'] })
export class WorkflowBuilderModule implements ModuleInterface {
	async entities() {
		const { WorkflowBuilderSession } = await import('./workflow-builder-session.entity');
		const { AiWorkflowBuilderConversation } = await import(
			'./ai-workflow-builder-conversation.entity'
		);
		const { AiWorkflowBuilderMessage } = await import('./ai-workflow-builder-message.entity');
		const { AiWorkflowBuilderDraft } = await import('./ai-workflow-builder-draft.entity');

		return [
			WorkflowBuilderSession,
			AiWorkflowBuilderConversation,
			AiWorkflowBuilderMessage,
			AiWorkflowBuilderDraft,
		];
	}
}
