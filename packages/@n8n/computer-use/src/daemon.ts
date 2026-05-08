import * as fs from 'node:fs/promises';
import * as http from 'node:http';

import type { GatewayConfig } from './config';
import { isOriginAllowed } from './config';
import { GatewayClient } from './gateway-client';
import { GatewaySession } from './gateway-session';
import {
	logger,
	printConnected,
	printDisconnected,
	printListening,
	printShuttingDown,
	printToolList,
	printWaiting,
} from './logger';
import { SettingsStore } from './settings-store';
import type { ConfirmResourceAccess } from './tools/types';

export type { ConfirmResourceAccess, ResourceDecision } from './tools/types';

export interface DaemonOptions {
	/** Called before a new connection. Receives a pre-seeded session; may mutate it. Return false to reject with HTTP 403. */
	confirmConnect: (url: string, session: GatewaySession) => Promise<boolean> | boolean;
	/** Called when a tool is about to access a resource that requires confirmation. */
	confirmResourceAccess: ConfirmResourceAccess;
	/** Called after connect/disconnect for status propagation, e.g. Electron tray. */
	onStatusChange?: (status: 'connected' | 'disconnected', url?: string) => void;
	/**
	 * When true, skip SIGINT/SIGTERM process handlers.
	 * Use this when the host process, e.g. Electron, manages its own shutdown.
	 */
	managedMode?: boolean;
}

interface DaemonState {
	config: GatewayConfig;
	client: GatewayClient | null;
	session: GatewaySession | null;
	connectedAt: string | null;
	connectedUrl: string | null;
	confirmingConnection: boolean;
}

let daemonOptions: DaemonOptions | null = null;
let settingsStore: SettingsStore | null = null;
let settingsStorePromise: Promise<SettingsStore> | null = null;

const state: DaemonState = {
	config: undefined as unknown as GatewayConfig,
	client: null,
	session: null,
	connectedAt: null,
	connectedUrl: null,
	confirmingConnection: false,
};

function getDaemonOptions(): DaemonOptions {
	if (!daemonOptions) {
		throw new Error('Daemon has not been initialized');
	}
	return daemonOptions;
}

function getCorsHeaders(
	reqOrigin: string | undefined,
	allowedOrigins: string[],
): Record<string, string> {
	const base: Record<string, string> = {
		['Access-Control-Allow-Methods']: 'GET, POST, OPTIONS',
		['Access-Control-Allow-Headers']: 'Content-Type',
	};

	if (reqOrigin && isOriginAllowed(reqOrigin, allowedOrigins)) {
		return { ...base, ['Access-Control-Allow-Origin']: reqOrigin, ['Vary']: 'Origin' };
	}

	return base;
}

function jsonResponse(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	status: number,
	body: Record<string, unknown>,
): void {
	res.writeHead(status, {
		['Content-Type']: 'application/json',
		...getCorsHeaders(req.headers.origin, state.config.allowedOrigins),
	});
	res.end(JSON.stringify(body));
}

function getDir(): string {
	return state.session?.dir ?? state.config.filesystem.dir;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
	return await new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks).toString()));
		req.on('error', reject);
	});
}

function handleHealth(req: http.IncomingMessage, res: http.ServerResponse): void {
	jsonResponse(req, res, 200, {
		status: 'ok',
		dir: getDir(),
		connected: state.client !== null,
	});
}

async function getSettingsStore(): Promise<SettingsStore> {
	if (settingsStore) return settingsStore;
	if (!settingsStorePromise) {
		settingsStorePromise = SettingsStore.create();
	}
	settingsStore = await settingsStorePromise;
	return settingsStore;
}

async function handleConnect(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const raw = await readBody(req);
	let url: string;
	let token: string;

	try {
		const body: unknown = JSON.parse(raw);
		if (!body || typeof body !== 'object') {
			jsonResponse(req, res, 400, { error: 'Invalid JSON body' });
			return;
		}
		const parsedBody = body as { url?: unknown; token?: unknown };
		url = typeof parsedBody.url === 'string' ? parsedBody.url : '';
		token = typeof parsedBody.token === 'string' ? parsedBody.token : '';
	} catch {
		jsonResponse(req, res, 400, { error: 'Invalid JSON body' });
		return;
	}

	if (!url || !token) {
		jsonResponse(req, res, 400, { error: 'Missing required fields: url, token' });
		return;
	}

	if (state.client) {
		jsonResponse(req, res, 409, {
			error: `Already connected to ${state.connectedUrl}. Disconnect first.`,
		});
		return;
	}

	if (state.confirmingConnection) {
		jsonResponse(req, res, 409, { error: 'A connection confirmation is already in progress.' });
		return;
	}

	let parsedOrigin: string;
	try {
		parsedOrigin = new URL(url).origin;
	} catch {
		jsonResponse(req, res, 400, { error: 'Invalid URL' });
		return;
	}

	if (!isOriginAllowed(parsedOrigin, state.config.allowedOrigins)) {
		logger.debug('Connection rejected: origin not in allowlist', {
			url,
			allowedOrigins: state.config.allowedOrigins,
		});
		jsonResponse(req, res, 403, { error: 'Connection rejected.' });
		return;
	}

	try {
		const store = await getSettingsStore();
		const defaults = store.getDefaults(state.config);
		const session = new GatewaySession(defaults, store);
		const options = getDaemonOptions();

		state.confirmingConnection = true;
		let approved: boolean;
		try {
			approved = await options.confirmConnect(url, session);
		} finally {
			state.confirmingConnection = false;
		}

		if (!approved) {
			jsonResponse(req, res, 403, { error: 'Connection rejected by user.' });
			return;
		}

		try {
			const stat = await fs.stat(session.dir);
			if (!stat.isDirectory()) {
				jsonResponse(req, res, 400, { error: `Invalid directory: ${session.dir}` });
				return;
			}
		} catch {
			jsonResponse(req, res, 400, { error: `Invalid directory: ${session.dir}` });
			return;
		}

		state.session = session;

		const client = new GatewayClient({
			url: url.replace(/\/$/, ''),
			apiKey: token,
			config: state.config,
			session,
			confirmResourceAccess: options.confirmResourceAccess,
			onPersistentFailure: () => {
				clearConnectionState();
				printDisconnected();
			},
			onDisconnected: () => {
				clearConnectionState();
			},
		});

		await client.start();

		state.client = client;
		state.connectedAt = new Date().toISOString();
		state.connectedUrl = url;

		const dir = getDir();
		logger.debug('Connected to n8n', { url, dir });
		printConnected(url);
		printToolList(client.tools);
		options.onStatusChange?.('connected', url);
		jsonResponse(req, res, 200, { status: 'connected', dir });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Connection failed', { error: message });
		jsonResponse(req, res, 500, { error: message });
	}
}

function clearConnectionState(): void {
	if (!state.client && !state.session && !state.connectedAt && !state.connectedUrl) return;
	state.client = null;
	state.session = null;
	state.connectedAt = null;
	state.connectedUrl = null;
	logger.debug('Disconnected');
	getDaemonOptions().onStatusChange?.('disconnected');
}

async function handleDisconnect(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	if (state.client) {
		await state.client.disconnect();
	}
	jsonResponse(req, res, 200, { status: 'disconnected' });
}

function handleStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
	jsonResponse(req, res, 200, {
		connected: state.client !== null,
		dir: getDir(),
		connectedAt: state.connectedAt,
		url: state.connectedUrl,
	});
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
	res.writeHead(200, {
		['Content-Type']: 'text/event-stream',
		['Cache-Control']: 'no-cache',
		['Connection']: 'keep-alive',
		...getCorsHeaders(req.headers.origin, state.config.allowedOrigins),
	});
	res.write('event: ready\ndata: {}\n\n');
}

function handleCors(req: http.IncomingMessage, res: http.ServerResponse): void {
	const reqOrigin = req.headers.origin;
	if (!reqOrigin || !isOriginAllowed(reqOrigin, state.config.allowedOrigins)) {
		res.writeHead(403);
		res.end();
		return;
	}
	res.writeHead(204, {
		...getCorsHeaders(reqOrigin, state.config.allowedOrigins),
		['Access-Control-Max-Age']: '86400',
	});
	res.end();
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
	const { method, url: reqUrl } = req;

	if (method === 'OPTIONS') {
		handleCors(req, res);
		return;
	}

	const reqOrigin = req.headers.origin;
	if (!reqOrigin || !isOriginAllowed(reqOrigin, state.config.allowedOrigins)) {
		logger.debug('Request rejected: origin not in allowlist', {
			origin: reqOrigin,
			allowedOrigins: state.config.allowedOrigins,
		});
		jsonResponse(req, res, 403, { error: 'Forbidden.' });
		return;
	}

	if (method === 'GET' && reqUrl === '/health') {
		handleHealth(req, res);
	} else if (method === 'POST' && reqUrl === '/connect') {
		void handleConnect(req, res);
	} else if (method === 'POST' && reqUrl === '/disconnect') {
		void handleDisconnect(req, res);
	} else if (method === 'GET' && reqUrl === '/status') {
		handleStatus(req, res);
	} else if (method === 'GET' && reqUrl === '/events') {
		handleEvents(req, res);
	} else {
		jsonResponse(req, res, 404, { error: 'Not found' });
	}
}

export function startDaemon(config: GatewayConfig, options: DaemonOptions): http.Server {
	daemonOptions = options;
	state.config = config;
	const { port } = config;

	settingsStorePromise = SettingsStore.create();
	void settingsStorePromise
		.then((store) => {
			settingsStore = store;
		})
		.catch((error: unknown) => {
			logger.error('Failed to initialize settings store', {
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		});

	const server = http.createServer(handleRequest);

	server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE') {
			logger.error('Port already in use', { port });
			process.exit(1);
		}
		throw error;
	});

	server.listen(port, '127.0.0.1', () => {
		printListening(port);
		printWaiting();
	});

	if (!options.managedMode) {
		const shutdown = () => {
			printShuttingDown();
			const done = () => server.close(() => process.exit(0));
			const flush = settingsStore ? settingsStore.flush() : Promise.resolve();
			if (state.client) {
				void Promise.all([state.client.disconnect(), flush]).finally(done);
			} else {
				void flush.finally(done);
			}
		};
		process.on('SIGINT', shutdown);
		process.on('SIGTERM', shutdown);
	}

	return server;
}
