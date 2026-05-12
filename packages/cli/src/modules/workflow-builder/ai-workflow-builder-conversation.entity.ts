import type { AiWorkflowBuilderConversationStatus } from '@n8n/api-types';
import { DateTimeColumn, Project, User, WithTimestamps, WorkflowEntity } from '@n8n/db';
import {
	Column,
	Entity,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	type Relation,
} from '@n8n/typeorm';

import type { AiWorkflowBuilderDraft } from './ai-workflow-builder-draft.entity';
import type { AiWorkflowBuilderMessage } from './ai-workflow-builder-message.entity';

@Entity({ name: 'ai_workflow_builder_conversation' })
export class AiWorkflowBuilderConversation extends WithTimestamps {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 36 })
	projectId: string;

	@ManyToOne('Project', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'projectId' })
	project?: Relation<Project>;

	@Column({ type: 'uuid' })
	userId: string;

	@ManyToOne('User', { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user?: Relation<User>;

	@Column({ type: 'varchar', length: 80 })
	title: string;

	@Column({ type: 'varchar', length: 16, default: 'active' })
	status: AiWorkflowBuilderConversationStatus;

	@Column({ type: 'varchar', length: 36, nullable: true })
	appliedWorkflowId: string | null;

	@ManyToOne('WorkflowEntity', { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'appliedWorkflowId' })
	appliedWorkflow?: Relation<WorkflowEntity> | null;

	@Column({ type: 'varchar', length: 512, default: '' })
	latestMessagePreview: string;

	@DateTimeColumn()
	lastMessageAt: Date;

	@DateTimeColumn({ nullable: true })
	deletedAt: Date | null;

	@OneToMany('AiWorkflowBuilderMessage', 'conversation')
	messages?: Array<Relation<AiWorkflowBuilderMessage>>;

	@OneToMany('AiWorkflowBuilderDraft', 'conversation')
	drafts?: Array<Relation<AiWorkflowBuilderDraft>>;
}
