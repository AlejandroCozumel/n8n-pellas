import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';

import { AiWorkflowBuilderMessage } from './ai-workflow-builder-message.entity';

@Service()
export class AiWorkflowBuilderMessageRepository extends Repository<AiWorkflowBuilderMessage> {
	constructor(dataSource: DataSource) {
		super(AiWorkflowBuilderMessage, dataSource.manager);
	}
}
