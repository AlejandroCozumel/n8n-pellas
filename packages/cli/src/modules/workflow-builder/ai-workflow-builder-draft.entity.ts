import type {
	AiWorkflowBuilderGeneratedWorkflow,
	AiWorkflowBuilderWorkflowOutline,
} from '@n8n/api-types';
import { JsonColumn, WithTimestamps, WorkflowEntity } from '@n8n/db';
import {
	Column,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	type Relation,
} from '@n8n/typeorm';

import type { AiWorkflowBuilderConversation } from './ai-workflow-builder-conversation.entity';
import type { AiWorkflowBuilderMessage } from './ai-workflow-builder-message.entity';

@Entity({ name: 'ai_workflow_builder_draft' })
export class AiWorkflowBuilderDraft extends WithTimestamps {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	conversationId: string;

	@ManyToOne('AiWorkflowBuilderConversation', 'drafts', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversationId' })
	conversation?: Relation<AiWorkflowBuilderConversation>;

	@Column({ type: 'uuid' })
	messageId: string;

	@ManyToOne('AiWorkflowBuilderMessage', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'messageId' })
	message?: Relation<AiWorkflowBuilderMessage>;

	@Column({ type: 'varchar', length: 128 })
	workflowName: string;

	@JsonColumn()
	workflowJson: AiWorkflowBuilderGeneratedWorkflow;

	@JsonColumn()
	workflowOutline: AiWorkflowBuilderWorkflowOutline;

	@Column({ type: 'varchar', length: 36, nullable: true })
	createdWorkflowId: string | null;

	@ManyToOne('WorkflowEntity', { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'createdWorkflowId' })
	createdWorkflow?: Relation<WorkflowEntity> | null;
}
