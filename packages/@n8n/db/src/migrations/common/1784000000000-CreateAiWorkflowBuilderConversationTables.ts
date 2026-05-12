import type { MigrationContext, ReversibleMigration } from '../migration-types';

const table = {
	conversations: 'ai_workflow_builder_conversation',
	messages: 'ai_workflow_builder_message',
	drafts: 'ai_workflow_builder_draft',
	projects: 'project',
	users: 'user',
	workflows: 'workflow_entity',
} as const;

export class CreateAiWorkflowBuilderConversationTables1784000000000 implements ReversibleMigration {
	async up({ schemaBuilder: { createTable, column } }: MigrationContext) {
		await createTable(table.conversations)
			.withColumns(
				column('id').uuid.primary.notNull,
				column('projectId').varchar(36).notNull,
				column('userId').uuid.notNull,
				column('title').varchar(80).notNull,
				column('status')
					.varchar(16)
					.default("'active'")
					.notNull.withEnumCheck(['active', 'generated', 'archived', 'failed']),
				column('appliedWorkflowId').varchar(36),
				column('latestMessagePreview').varchar(512).default("''").notNull,
				column('lastMessageAt').timestampTimezone().notNull.default('NOW()'),
				column('deletedAt').timestampTimezone(),
			)
			.withForeignKey('projectId', {
				tableName: table.projects,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withForeignKey('userId', {
				tableName: table.users,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withForeignKey('appliedWorkflowId', {
				tableName: table.workflows,
				columnName: 'id',
				onDelete: 'SET NULL',
			})
			.withIndexOn(['projectId', 'userId', 'deletedAt', 'updatedAt']).withTimestamps;

		await createTable(table.messages)
			.withColumns(
				column('id').uuid.primary.notNull,
				column('conversationId').uuid.notNull,
				column('role').varchar(16).notNull.withEnumCheck(['user', 'assistant']),
				column('content').text.notNull,
				column('status')
					.varchar(16)
					.default("'success'")
					.notNull.withEnumCheck(['pending', 'success', 'error']),
				column('responseState')
					.varchar(32)
					.withEnumCheck(['generated', 'needs_clarification', 'partial', 'unsupported', 'error']),
				column('metadata').json,
			)
			.withForeignKey('conversationId', {
				tableName: table.conversations,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withIndexOn(['conversationId', 'createdAt']).withTimestamps;

		await createTable(table.drafts)
			.withColumns(
				column('id').uuid.primary.notNull,
				column('conversationId').uuid.notNull,
				column('messageId').uuid.notNull,
				column('workflowName').varchar(128).notNull,
				column('workflowJson').json.notNull,
				column('workflowOutline').json.notNull,
				column('createdWorkflowId').varchar(36),
			)
			.withForeignKey('conversationId', {
				tableName: table.conversations,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withForeignKey('messageId', {
				tableName: table.messages,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withForeignKey('createdWorkflowId', {
				tableName: table.workflows,
				columnName: 'id',
				onDelete: 'SET NULL',
			})
			.withIndexOn(['conversationId', 'createdAt']).withTimestamps;
	}

	async down({ schemaBuilder: { dropTable } }: MigrationContext) {
		await dropTable(table.drafts);
		await dropTable(table.messages);
		await dropTable(table.conversations);
	}
}
