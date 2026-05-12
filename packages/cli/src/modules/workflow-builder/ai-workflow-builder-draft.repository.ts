import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';

import { AiWorkflowBuilderDraft } from './ai-workflow-builder-draft.entity';

@Service()
export class AiWorkflowBuilderDraftRepository extends Repository<AiWorkflowBuilderDraft> {
	constructor(dataSource: DataSource) {
		super(AiWorkflowBuilderDraft, dataSource.manager);
	}
}
