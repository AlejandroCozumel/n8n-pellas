import { Service } from '@n8n/di';
import { DataSource, IsNull, Repository } from '@n8n/typeorm';

import { AiWorkflowBuilderConversation } from './ai-workflow-builder-conversation.entity';

@Service()
export class AiWorkflowBuilderConversationRepository extends Repository<AiWorkflowBuilderConversation> {
	constructor(dataSource: DataSource) {
		super(AiWorkflowBuilderConversation, dataSource.manager);
	}

	async findUserConversation(id: string, projectId: string, userId: string) {
		return await this.findOne({
			where: { id, projectId, userId, deletedAt: IsNull() },
		});
	}

	async findUserConversations({
		projectId,
		userId,
		limit,
		offset,
	}: {
		projectId: string;
		userId: string;
		limit: number;
		offset: number;
	}) {
		return await this.findAndCount({
			where: { projectId, userId, deletedAt: IsNull() },
			order: { updatedAt: 'DESC' },
			take: limit,
			skip: offset,
		});
	}
}
