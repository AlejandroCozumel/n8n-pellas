import { Logger } from '@n8n/backend-common';
import type {
	AiWorkflowBuilderGeneratedWorkflow,
	AiWorkflowBuilderResponseState,
	AiWorkflowBuilderWorkflowOutline,
} from '@n8n/api-types';
import { generatedWorkflowSchema, workflowOutlineSchema } from '@n8n/api-types';
import { Service } from '@n8n/di';
import axios from 'axios';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { InternalServerError } from '@/errors/response-errors/internal-server.error';

const CONVERSATIONAL_SYSTEM_PROMPT = `You are an expert n8n workflow-building assistant.

Return ONLY valid JSON. No markdown and no code fences.

Your response must have this shape:
{
  "state": "generated" | "needs_clarification" | "partial" | "unsupported",
  "message": "Helpful user-facing response",
  "suggestedReplies": ["optional short reply", "..."],
  "missingInformation": ["optional missing detail"],
  "workflowOutline": { "steps": [{ "label": "Step label", "nodeType": "optional n8n node type", "description": "What this step does" }] },
  "workflow": { "name": "...", "nodes": [...], "connections": {...}, "settings": {...}, "active": false }
}

Rules:
- Ask one primary clarification question when required information is missing.
- When you provide a workflowOutline for an automatable workflow, also provide a complete tentative workflow JSON in the same response so the user can create it immediately.
- If information is missing, make practical assumptions in the workflow, use clear placeholder parameter values, and explain what the user should adjust.
- Only omit workflow when the request is unsupported or too vague to create even a useful tentative draft.
- Provide a partial workflowOutline when useful.
- Use suggestedReplies only for short option-style replies.
- Never ask users to paste API keys, credentials, passwords, or secrets.
- If you generate workflow JSON, follow the same n8n workflow structure rules:
  - top-level fields: name, nodes, connections, settings, active
  - active must be false
  - settings must include { "executionOrder": "v1" }
  - each node must have parameters, id, name, type, typeVersion, position, and description
  - use realistic n8n node types
  - connections must be indexed by source node name in n8n's standard shape.`;

const OPENAI_CHAT_MODEL = process.env.N8N_AI_WORKFLOW_BUILDER_MODEL ?? 'gpt-5.5';

interface N8nConnection {
	node: string;
	type: string;
	index: number;
}

export interface AiWorkflowBuilderAssistantResponse {
	state: Exclude<AiWorkflowBuilderResponseState, 'error'>;
	message: string;
	suggestedReplies?: string[];
	missingInformation?: string[];
	workflowOutline?: AiWorkflowBuilderWorkflowOutline;
	workflow?: AiWorkflowBuilderGeneratedWorkflow;
}

/**
 * Normalises whatever the LLM returned into the exact n8n connections shape:
 * { "Node Name": { "main": [[{ node, type, index }]] } }
 */
function normaliseConnections(
	raw: Record<string, unknown>,
): Record<string, { main: Array<N8nConnection[]> }> {
	const result: Record<string, { main: Array<N8nConnection[]> }> = {};

	for (const [sourceName, value] of Object.entries(raw)) {
		if (!value || typeof value !== 'object') continue;

		// Already correct shape: { main: [[...]] }
		const asObj = value as Record<string, unknown>;
		if (Array.isArray(asObj.main)) {
			const main: Array<N8nConnection[]> = [];
			for (const port of asObj.main) {
				if (Array.isArray(port)) {
					main.push(
						port.map((c) =>
							typeof c === 'object' && c !== null
								? {
										node: String((c as Record<string, unknown>).node ?? ''),
										type: 'main',
										index: Number((c as Record<string, unknown>).index ?? 0),
									}
								: { node: String(c), type: 'main', index: 0 },
						),
					);
				} else if (typeof port === 'object' && port !== null) {
					// port is a connection object, not wrapped in array
					const conn = port as Record<string, unknown>;
					main.push([
						{ node: String(conn.node ?? ''), type: 'main', index: Number(conn.index ?? 0) },
					]);
				}
			}
			result[sourceName] = { main };
			continue;
		}

		// Flat array of connection objects: [{ node, type, index }, ...]
		if (Array.isArray(value)) {
			result[sourceName] = {
				main: [
					(value as Array<Record<string, unknown>>).map((c) => ({
						node: String(c.node ?? ''),
						type: 'main',
						index: Number(c.index ?? 0),
					})),
				],
			};
			continue;
		}
	}

	return result;
}

@Service()
export class AiWorkflowBuilderService {
	constructor(private readonly logger: Logger) {}

	async generateAssistantResponse({
		message,
		history,
		currentWorkflow,
	}: {
		message: string;
		history: Array<{ role: 'user' | 'assistant'; content: string }>;
		currentWorkflow?: unknown;
	}): Promise<AiWorkflowBuilderAssistantResponse> {
		const apiKey = process.env.N8N_AI_OPENAI_KEY;

		if (!apiKey) {
			throw new BadRequestError(
				'AI Workflow Builder is not configured. Set N8N_AI_OPENAI_KEY to enable it.',
			);
		}

		let responseText: string;

		try {
			const response = await axios.post<{
				choices: Array<{ message: { content: string } }>;
			}>(
				'https://api.openai.com/v1/chat/completions',
				{
					model: OPENAI_CHAT_MODEL,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: CONVERSATIONAL_SYSTEM_PROMPT },
						...history,
						...(currentWorkflow
							? [
									{
										role: 'system' as const,
										content: `Current applied workflow state: ${JSON.stringify(currentWorkflow)}`,
									},
								]
							: []),
						{ role: 'user', content: message },
					],
				},
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
					},
					timeout: 60_000,
				},
			);

			responseText = response.data.choices[0]?.message?.content ?? '';
		} catch (error) {
			this.logger.error(
				'Failed to call OpenAI API for conversational AI Builder',
				this.toOpenAiLogDetails(error),
			);
			throw new InternalServerError('Failed to generate a response. Please try again.');
		}

		try {
			const parsed = JSON.parse(this.cleanJsonResponse(responseText)) as Record<string, unknown>;
			const state = this.parseAssistantState(parsed.state);
			const messageText = typeof parsed.message === 'string' ? parsed.message : '';

			if (!messageText.trim()) {
				throw new Error('Assistant response is missing message');
			}

			const workflow = this.parseWorkflow(parsed.workflow);
			const workflowOutline = this.parseWorkflowOutline(parsed.workflowOutline, workflow);

			return {
				state: workflow ? 'generated' : state,
				message: messageText.slice(0, 10_000),
				suggestedReplies: this.parseSuggestedReplies(parsed.suggestedReplies),
				missingInformation: this.parseStringArray(parsed.missingInformation, 10, 200),
				workflowOutline,
				workflow,
			};
		} catch (error) {
			this.logger.error('Failed to parse conversational AI Builder response', {
				error,
				responseText,
			});
			throw new InternalServerError(
				'AI returned an invalid response. Please try rephrasing your request.',
			);
		}
	}

	private cleanJsonResponse(responseText: string) {
		return responseText
			.replace(/^```json\s*/i, '')
			.replace(/^```\s*/i, '')
			.replace(/```$/i, '')
			.trim();
	}

	private parseAssistantState(value: unknown): Exclude<AiWorkflowBuilderResponseState, 'error'> {
		if (
			value === 'generated' ||
			value === 'needs_clarification' ||
			value === 'partial' ||
			value === 'unsupported'
		) {
			return value;
		}
		return 'partial';
	}

	private parseWorkflow(value: unknown): AiWorkflowBuilderGeneratedWorkflow | undefined {
		const result = generatedWorkflowSchema.safeParse(value);
		if (!result.success) return undefined;

		const workflow = result.data;
		if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) return undefined;

		workflow.active = false;
		workflow.settings = { executionOrder: 'v1', ...workflow.settings };
		workflow.connections = normaliseConnections(workflow.connections);

		return workflow;
	}

	private parseWorkflowOutline(
		value: unknown,
		workflow?: AiWorkflowBuilderGeneratedWorkflow,
	): AiWorkflowBuilderWorkflowOutline | undefined {
		const result = workflowOutlineSchema.safeParse(value);
		if (result.success) return result.data;

		if (!workflow) return undefined;

		return {
			steps: workflow.nodes.slice(0, 20).map((node: Record<string, unknown>) => ({
				label: typeof node.name === 'string' ? node.name : 'Workflow step',
				nodeType: typeof node.type === 'string' ? node.type : undefined,
				description:
					typeof node.description === 'string'
						? node.description
						: `Runs ${typeof node.name === 'string' ? node.name : 'this workflow step'}.`,
			})),
		};
	}

	private parseSuggestedReplies(value: unknown): string[] | undefined {
		const replies = this.parseStringArray(value, 6, 120);
		return replies.length ? replies : undefined;
	}

	private parseStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
		if (!Array.isArray(value)) return [];
		return value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
			.filter(Boolean)
			.slice(0, maxItems)
			.map((item) => item.slice(0, maxLength));
	}

	private toOpenAiLogDetails(error: unknown) {
		if (axios.isAxiosError(error)) {
			return {
				model: OPENAI_CHAT_MODEL,
				status: error.response?.status,
				statusText: error.response?.statusText,
				response: error.response?.data,
				message: error.message,
			};
		}

		return {
			model: OPENAI_CHAT_MODEL,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
