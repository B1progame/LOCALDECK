/* The MCP endpoint: lets an AI create and update LocalDeck projects.
   Stateless, HTTP POST with JSON answers, tools only. Serves clients of the 2025 versions (initialize
   handshake) and of 2026-07-28 (every request carries its version). */
import { AiError, checkStored, connect, createProject, deleteProject, listProjects, MAX_CALLS_PER_HOUR, MAX_FILES, MAX_PROJECT_MIB, readDetails, readEdits, readFiles, readProject, updateProject, type AiEnv, type Connection, type ProjectInfo } from './ai.ts';
import { guide, TOPICS } from './guide.ts';

const MODERN = '2026-07-28';
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'localdeck', title: 'LocalDeck', version: '1.1.0' };
const VERSION_FIELD = 'io.modelcontextprotocol/protocolVersion';
/** One call. A larger project is built with several calls, so a call stays within the computing time of the free plan. */
const REQUEST_MIB = 6;
/** The 2025-03-26 version lets a client send several messages at once. */
const MAX_BATCH = 10;
const MAX_BODY = REQUEST_MIB * 1024 * 1024;
const TOO_LARGE = `The request is too large. One call may carry ${REQUEST_MIB} MiB. Create the project first and add more files with update_project.`;

const INSTRUCTIONS = `LocalDeck is a private offline library for HTML projects: study sheets, quizzes, games, simulations, presentations and small tools.
Before your first project read the guide: read_guide explains how the website works, what AI studio asks for and how to output a project.
With these tools you create a project, get a private link for the person, and change the project later. The link stays the same after changes; people who open it get the newest version.

How to build a good project:
- Write a complete index.html. Put CSS and JavaScript inside it, or in extra files with relative paths.
- It must work offline: no CDNs, no web fonts, no remote images, no fetch to other servers. They are blocked.
- It runs in an isolated frame: localStorage, cookies and service workers are not available. Keep state in memory.
- Make it work on phones and with touch, use large tap targets, readable contrast and a layout that fits 360 px.
- Draw illustrations as SVG. Add cover.svg (1200x750) as the cover. Do not write localdeck.json, it is created from the details you pass.
- Use the language of the person. A project may have ${MAX_PROJECT_MIB} MiB and ${MAX_FILES} files. One call may carry ${REQUEST_MIB} MiB, add more with update_project.
- Pass subject, topic, description and 3 to 6 tags (hashtags), so the project can be found in the library.
- create_project and update_project answer with problems they find. Fix them and update again.
For changes prefer "edits" over sending whole files again. Read the file first so "find" matches exactly.
Always give the person the complete link, including everything after "#". Whoever has the link can open the project. Do not put secrets or other people's personal data into projects.`;

const text = { type: 'string' };
const details = {
  title: { ...text, description: 'Short title, shown in the library' },
  type: { ...text, enum: ['game', 'learning', 'app', 'tool', 'simulation', 'presentation', 'quiz', 'other'], description: 'Kind of project. Study sheets are "learning".' },
  subject: { ...text, description: 'School subject or category, such as Biology' },
  topic: text,
  description: { ...text, description: 'One or two sentences' },
  tags: { type: 'array', items: text },
  language: { ...text, description: 'Language code, such as de or en' },
};
const files = { type: 'array', description: 'Files of the project. index.html is required for a new project.', items: { type: 'object', properties: { path: { ...text, description: 'Relative path, such as index.html or assets/logo.svg' }, content: { ...text, description: 'The complete content' }, encoding: { ...text, enum: ['utf8', 'base64'], description: 'utf8 is the default' } }, required: ['path', 'content'] } };
const projectId = { ...text, description: 'The project_id from create_project or list_projects' };

const TOOLS = [
  { name: 'create_project', title: 'Create a project', description: 'Creates an HTML project in LocalDeck and returns a private link that you give to the person. Use it when someone wants a study sheet, quiz, game, simulation, presentation or tool.', inputSchema: { type: 'object', properties: { ...details, files }, required: ['title', 'files'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: 'update_project', title: 'Update a project', description: 'Changes a project. The link stays the same. Use "edits" for small changes, "files" to add or replace whole files, "remove" to delete files, and the details to rename it.', inputSchema: { type: 'object', properties: { project_id: projectId, edits: { type: 'array', description: 'Replaces a text that appears exactly once in the file', items: { type: 'object', properties: { path: text, find: text, replace: text, all: { type: 'boolean', description: 'Replace every place, not only one' } }, required: ['path', 'find', 'replace'] } }, files, remove: { type: 'array', items: text, description: 'Paths to delete' }, ...details }, required: ['project_id'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: 'read_project', title: 'Read a project', description: 'Without "path": the link, details and list of files. With "path": the content of that file.', inputSchema: { type: 'object', properties: { project_id: projectId, path: { ...text, description: 'Such as index.html' }, offset: { type: 'integer', minimum: 0, description: 'For files over 100,000 characters: where to continue' } }, required: ['project_id'] }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'check_project', title: 'Check a project', description: 'Looks for things that do not work in LocalDeck: internet requests, missing files, browser storage, missing viewport or cover.', inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'] }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'read_guide', title: 'Read the LocalDeck guide', description: 'How LocalDeck works and how a project has to look. Read it before the first project. Topics: website (pages, import, links, what is blocked), ai_studio (the request AI studio writes, for a kind and an idea), output (how to hand over files, limits, text format for chats without tools), design, types (types and details). Without a topic: everything except ai_studio.', inputSchema: { type: 'object', properties: { topic: { ...text, enum: [...TOPICS] }, kind: { ...text, enum: ['game', 'learning', 'quiz', 'app', 'tool', 'simulation', 'presentation', 'other'], description: 'For ai_studio' }, idea: { ...text, description: 'For ai_studio' }, title: text, subject: text, language: text } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'list_projects', title: 'List projects', description: 'The projects of this connection with title, link, downloads and expiry.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'delete_project', title: 'Delete a project', description: 'Deletes a project for good. Its link stops working at once. Ask the person first.', inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];

type Id = string | number | null;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown>; result?: unknown; error?: unknown };

/* Clients inside a browser need CORS. The address contains the secret and there are no cookies, so any page may ask:
   without the secret it gets nothing. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id', 'access-control-expose-headers': 'mcp-protocol-version, www-authenticate, retry-after', 'access-control-max-age': '86400' };
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...CORS, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(body === null ? {} : { 'content-type': 'application/json' }), ...extra } });
const failure = (status: number, id: Id, code: number, message: string, data?: unknown, extra: Record<string, string> = {}) => reply(status, { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, extra);
/** Clients show the name, the link and the picture of a server. */
const serverInfo = (env: AiEnv) => ({ ...SERVER, ...(env.APP_URL ? { websiteUrl: env.APP_URL, icons: [{ src: `${env.APP_URL}icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }] } : {}) });

/** Header values may be sent as =?base64?...?= when they contain special characters. */
function header(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  const coded = value?.match(/^=\?base64\?(.*)\?=$/);
  if (!coded) return value;
  try { return new TextDecoder().decode(Uint8Array.from(atob(coded[1]!), char => char.charCodeAt(0))); } catch { return value; }
}

function summary(project: ProjectInfo, verb: string): string {
  return `${verb} "${project.title}" (version ${project.version}, ${Math.ceil(project.size / 1024)} KB).\nLink for the person: ${project.link}\nproject_id: ${project.id}\nThe link works until ${project.expiresAt.slice(0, 10)}. Every update extends it.${project.problems.length ? `\n\nProblems found, please fix them with update_project:\n- ${project.problems.join('\n- ')}` : ''}`;
}

class UnknownTool extends Error { constructor(name: string) { super(`Unknown tool: ${name}`); } }

type Outcome = string | { text: string; data: Record<string, unknown> };
const outcome = (project: ProjectInfo, verb: string): Outcome => ({ text: summary(project, verb), data: { project_id: project.id, title: project.title, link: project.link, version: project.version, bytes: project.size, expires: project.expiresAt, problems: project.problems } });

async function runTool(env: AiEnv, connection: Connection, name: string, input: Record<string, unknown>): Promise<Outcome> {
  const id = typeof input.project_id === 'string' ? input.project_id.trim() : '';
  switch (name) {
    case 'create_project': return outcome(await createProject(env, connection, readFiles(input.files), readDetails(input)), 'Created');
    case 'update_project': {
      const remove = input.remove === undefined ? [] : input.remove;
      if (!Array.isArray(remove) || !remove.every(path => typeof path === 'string')) throw new AiError('"remove" must be a list of paths.');
      return outcome(await updateProject(env, connection, id, { files: readFiles(input.files), edits: readEdits(input.edits), remove: remove as string[], details: readDetails(input) }), 'Updated');
    }
    case 'read_project': return readProject(env, connection, id, typeof input.path === 'string' && input.path ? input.path : undefined, Number.isSafeInteger(input.offset) && Number(input.offset) > 0 ? Number(input.offset) : 0);
    case 'check_project': { const problems = await checkStored(env, connection, id); return problems.length ? `Problems:\n- ${problems.join('\n- ')}` : 'No problems found.'; }
    case 'read_guide': return guide(typeof input.topic === 'string' ? input.topic : undefined, input, { projectMiB: MAX_PROJECT_MIB, files: MAX_FILES, requestMiB: REQUEST_MIB, callsPerHour: MAX_CALLS_PER_HOUR, changesPerDay: connection.limits.aiPerDay, days: connection.limits.aiDays });
    case 'list_projects': { const projects = await listProjects(env, connection); return { text: projects.length ? JSON.stringify(projects, null, 2) : 'This connection has no projects yet.', data: { projects } }; }
    case 'delete_project': await deleteProject(env, connection, id); return 'Deleted. The link no longer works.';
    default: throw new UnknownTool(name);
  }
}

async function callTool(env: AiEnv, connection: Connection, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const name = String(params.name ?? '');
  const input = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
  try {
    const result = await runTool(env, connection, name, input);
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : result.text }], ...(typeof result === 'string' ? {} : { structuredContent: result.data }), isError: false };
  }
  catch (error) {
    if (error instanceof UnknownTool) throw error;
    if (!(error instanceof AiError)) console.error('ai_tool_failed', name, error instanceof Error ? error.message : 'unknown');
    return { content: [{ type: 'text', text: error instanceof AiError ? error.message : 'LocalDeck could not do that right now. Try again.' }], isError: true };
  }
}

/** Reads at most MAX_BODY bytes. The length a client announces is not trusted. Null: too large. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** `unknownToken` limits guessing: it is asked before a wrong token is answered. */
export async function handleMcp(request: Request, env: AiEnv, token: string, isAdmin: (email: string) => boolean, unknownToken: () => Promise<boolean>): Promise<Response> {
  if (request.method === 'OPTIONS') return reply(204, null);
  // There are no server messages and no sessions, so GET and DELETE are not offered.
  if (request.method !== 'POST') return reply(405, null, { allow: 'POST, OPTIONS' });
  let id: Id = null;
  try {
    const connection = await connect(env, token, isAdmin);
    if (connection === null) return await unknownToken() ? failure(401, null, -32001, 'This LocalDeck connection does not exist. Create a new one in LocalDeck under Settings, Connect an AI.', undefined, { 'www-authenticate': 'Bearer realm="LocalDeck"' }) : failure(429, null, -32001, 'Too many attempts. Try again later.', undefined, { 'retry-after': '3600' });
    if ('status' in connection) return failure(connection.status, null, -32001, connection.message, undefined, connection.status === 429 ? { 'retry-after': '600' } : {});
    const body = await readBody(request);
    if (body === null) return failure(413, null, -32600, TOO_LARGE);
    let message: unknown;
    try { message = JSON.parse(body); } catch { return failure(400, null, -32700, 'Parse error'); }
    if (Array.isArray(message)) {
      if (!message.length || message.length > MAX_BATCH) return failure(400, null, -32600, `A batch must have 1 to ${MAX_BATCH} messages.`);
      const answers: unknown[] = [];
      for (const entry of message) { const answer = await handleMessage(request, env, connection, entry, true); if (answer.status !== 202) answers.push(await answer.json()); }
      return answers.length ? reply(200, answers) : reply(202, null);
    }
    const asked = (message as Message | null)?.id;
    if (typeof asked === 'string' || typeof asked === 'number') id = asked;
    return await handleMessage(request, env, connection, message, false);
  } catch (error) {
    // A client can show and repeat this. A plain web error would only say that the connection broke.
    console.error('mcp_failed', error instanceof Error ? error.message : 'unknown');
    return failure(503, id, -32603, 'LocalDeck is not reachable right now. Try again in a moment.', undefined, { 'retry-after': '5' });
  }
}

async function handleMessage(request: Request, env: AiEnv, connection: Connection, input: unknown, batch: boolean): Promise<Response> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400, null, -32600, 'Invalid request');
  const message = input as Message;
  if (message.jsonrpc !== '2.0') return failure(400, null, -32600, 'Invalid request');
  // An answer of the client to a question of the server. LocalDeck asks none, so there is nothing to do.
  if (message.method === undefined && ('result' in message || 'error' in message)) return reply(202, null);
  if (typeof message.method !== 'string') return failure(400, null, -32600, 'Invalid request');
  const { method } = message;
  if (message.id === undefined || message.id === null) return reply(202, null);
  if (typeof message.id !== 'string' && typeof message.id !== 'number') return failure(400, null, -32600, 'Invalid request: "id" must be a text or a number');
  const id = message.id, params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};
  const meta = (params._meta && typeof params._meta === 'object' ? params._meta : {}) as Record<string, unknown>;
  const version = typeof meta[VERSION_FIELD] === 'string' ? meta[VERSION_FIELD] as string : null;
  const ok = (result: Record<string, unknown>) => reply(200, { jsonrpc: '2.0', id, result });
  const call = async (finish: (result: Record<string, unknown>) => Response) => {
    try { return finish(await callTool(env, connection, params)); }
    catch (error) { if (error instanceof UnknownTool) return failure(version === null ? 200 : 400, id, -32602, error.message); throw error; }
  };

  if (version !== null) {
    if (version !== MODERN) return failure(400, id, -32022, 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: version });
    if (batch) return failure(400, id, -32600, 'This protocol version has no batches.');
    const expected: Array<[string, unknown]> = [['MCP-Protocol-Version', version], ['Mcp-Method', method], ...(method === 'tools/call' ? [['Mcp-Name', params.name] as [string, unknown]] : [])];
    for (const [name, value] of expected) if (header(request, name) !== value) return failure(400, id, -32020, `Header mismatch: ${name} header value '${header(request, name) ?? ''}' does not match body value '${String(value)}'`);
    const complete = (result: Record<string, unknown>) => ok({ resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo(env) } });
    if (method === 'server/discover') return complete({ supportedVersions: [MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'private' });
    if (method === 'tools/list') return complete({ tools: TOOLS, ttlMs: 3_600_000, cacheScope: 'private' });
    if (method === 'tools/call') return call(complete);
    return failure(404, id, -32601, 'Method not found');
  }

  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '');
    return ok({ protocolVersion: LEGACY.includes(requested) ? requested : LEGACY[0], capabilities: { tools: {} }, serverInfo: serverInfo(env), instructions: INSTRUCTIONS });
  }
  const announced = request.headers.get('MCP-Protocol-Version');
  if (announced && !LEGACY.includes(announced)) return failure(400, id, announced === MODERN ? -32020 : -32022, announced === MODERN ? `Header mismatch: the body has no ${VERSION_FIELD}` : 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: announced });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') return call(ok);
  return failure(200, id, -32601, 'Method not found');
}
