import type {
	AiWorkflowBuilderAssistantMessageMetadata,
	AiWorkflowBuilderMessageRole,
	AiWorkflowBuilderMessageStatus,
	AiWorkflowBuilderResponseState,
} from '@n8n/api-types';
import { JsonColumn, WithTimestamps } from '@n8n/db';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from '@n8n/typeorm';

import type { AiWorkflowBuilderConversation } from './ai-workflow-builder-conversation.entity';

@Entity({ name: 'ai_workflow_builder_message' })
export class AiWorkflowBuilderMessage extends WithTimestamps {
	@PrimaryColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	conversationId: string;

	@ManyToOne('AiWorkflowBuilderConversation', 'messages', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversationId' })
	conversation?: Relation<AiWorkflowBuilderConversation>;

	@Column({ type: 'varchar', length: 16 })
	role: AiWorkflowBuilderMessageRole;

	@Column('text')
	content: string;

	@Column({ type: 'varchar', length: 16, default: 'success' })
	status: AiWorkflowBuilderMessageStatus;

	@Column({ type: 'varchar', length: 32, nullable: true })
	responseState: AiWorkflowBuilderResponseState | null;

	@JsonColumn({ nullable: true })
	metadata: AiWorkflowBuilderAssistantMessageMetadata | null;
}
