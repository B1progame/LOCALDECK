/* The MCP endpoint: lets an AI create and update LocalDeck projects.
   Stateless, HTTP POST with JSON answers, tools only. Serves clients of the 2025 versions (initialize
   handshake) and of 2026-07-28 (every request carries its version). */
import { AiError, connect, createProject, deleteProject, listProjects, readDetails, readEdits, readFiles, readProject, updateProject, type AiEnv, type Connection, type ProjectInfo } from './ai.ts';

const MODERN = '2026-07-28';
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'localdeck', title: 'LocalDeck', version: '1.0.0' };
const VERSION_FIELD = 'io.modelcontextprotocol/protocolVersion';
const MAX_BODY = 3 * 1024 * 1024;

const INSTRUCTIONS = `LocalDeck is a private offline library for HTML projects: study sheets, quizzes, games, simulations, presentations and small tools.
With these tools you create a project, get a private link for the person, and change the project later. The link stays the same after changes; people who open it get the newest version.

How to build a good project:
- Write a complete index.html. Put CSS and JavaScript inside it, or in extra files with relative paths.
- It must work offline: no CDNs, no web fonts, no remote images, no fetch to other servers. They are blocked.
- It runs in an isolated frame: localStorage, cookies and service workers are not available. Keep state in memory.
- Make it work on phones and with touch, use large tap targets, readable contrast and a layout that fits 360 px.
- Draw illustrations as SVG. Add cover.svg (1200x750) as the cover. Do not write localdeck.json, it is created from the details you pass.
- Use the language of the person. The whole project may be at most 1 MiB.
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
  { name: 'update_project', title: 'Update a project', description: 'Changes a project. The link stays the same. Use "edits" for small changes, "files" to add or replace whole files, "remove" to delete files, and the details to rename it.', inputSchema: { type: 'object', properties: { project_id: projectId, edits: { type: 'array', description: 'Replaces a text that appears exactly once in the file', items: { type: 'object', properties: { path: text, find: text, replace: text }, required: ['path', 'find', 'replace'] } }, files, remove: { type: 'array', items: text, description: 'Paths to delete' }, ...details }, required: ['project_id'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: 'read_project', title: 'Read a project', description: 'Without "path": the link, details and list of files. With "path": the content of that file.', inputSchema: { type: 'object', properties: { project_id: projectId, path: { ...text, description: 'Such as index.html' } }, required: ['project_id'] }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'list_projects', title: 'List projects', description: 'The projects of this connection with title, link, downloads and expiry.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'delete_project', title: 'Delete a project', description: 'Deletes a project for good. Its link stops working at once. Ask the person first.', inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];

type Id = string | number | null;
type Message = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: Record<string, unknown> };

const reply = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'cache-control': 'no-store', ...(body === null ? {} : { 'content-type': 'application/json' }) } });
const failure = (status: number, id: Id, code: number, message: string, data?: unknown) => reply(status, { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

/** Header values may be sent as =?base64?...?= when they contain special characters. */
function header(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  const coded = value?.match(/^=\?base64\?(.*)\?=$/);
  if (!coded) return value;
  try { return new TextDecoder().decode(Uint8Array.from(atob(coded[1]!), char => char.charCodeAt(0))); } catch { return value; }
}

function summary(project: ProjectInfo, verb: string): string {
  return `${verb} "${project.title}" (version ${project.version}, ${Math.ceil(project.size / 1024)} KB).\nLink for the person: ${project.link}\nproject_id: ${project.id}\nThe link works until ${project.expiresAt.slice(0, 10)}. Every update extends it.`;
}

async function runTool(env: AiEnv, connection: Connection, name: string, input: Record<string, unknown>): Promise<string> {
  const id = typeof input.project_id === 'string' ? input.project_id.trim() : '';
  switch (name) {
    case 'create_project': return summary(await createProject(env, connection, readFiles(input.files), readDetails(input)), 'Created');
    case 'update_project': {
      const remove = input.remove === undefined ? [] : input.remove;
      if (!Array.isArray(remove) || !remove.every(path => typeof path === 'string')) throw new AiError('"remove" must be a list of paths.');
      return summary(await updateProject(env, connection, id, { files: readFiles(input.files), edits: readEdits(input.edits), remove: remove as string[], details: readDetails(input) }), 'Updated');
    }
    case 'read_project': return readProject(env, connection, id, typeof input.path === 'string' && input.path ? input.path : undefined);
    case 'list_projects': { const projects = await listProjects(env, connection); return projects.length ? JSON.stringify(projects, null, 2) : 'This connection has no projects yet.'; }
    case 'delete_project': await deleteProject(env, connection, id); return 'Deleted. The link no longer works.';
    default: throw new AiError(`There is no tool ${name}.`);
  }
}

async function callTool(env: AiEnv, connection: Connection, params: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }> {
  const name = String(params.name ?? '');
  const input = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
  try { return { content: [{ type: 'text', text: await runTool(env, connection, name, input) }], isError: false }; }
  catch (error) {
    if (!(error instanceof AiError)) console.error('ai_tool_failed', name, error instanceof Error ? error.message : 'unknown');
    return { content: [{ type: 'text', text: error instanceof AiError ? error.message : 'LocalDeck could not do that right now. Try again.' }], isError: true };
  }
}

/** `unknownToken` limits guessing: it is asked before a wrong token is answered. */
export async function handleMcp(request: Request, env: AiEnv, token: string, isAdmin: (email: string) => boolean, unknownToken: () => Promise<boolean>): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const connection = await connect(env, token, isAdmin);
  if (connection === null) return await unknownToken() ? failure(401, null, -32001, 'This LocalDeck connection does not exist. Create a new one in LocalDeck under Settings, Connect an AI.') : failure(429, null, -32001, 'Too many attempts.');
  if (typeof connection === 'string') return failure(403, null, -32001, connection);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return failure(413, null, -32600, 'The request is too large. A project may be at most 1 MiB.');
  let message: Message;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY) return failure(413, null, -32600, 'The request is too large. A project may be at most 1 MiB.');
    message = JSON.parse(body) as Message;
  } catch { return failure(400, null, -32700, 'Parse error'); }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(400, null, -32600, 'Invalid request');
  const { method } = message;
  if (message.id === undefined || message.id === null) return reply(202, null);
  const id = message.id, params = message.params && typeof message.params === 'object' ? message.params : {};
  const meta = (params._meta && typeof params._meta === 'object' ? params._meta : {}) as Record<string, unknown>;
  const version = typeof meta[VERSION_FIELD] === 'string' ? meta[VERSION_FIELD] as string : null;
  const ok = (result: Record<string, unknown>) => reply(200, { jsonrpc: '2.0', id, result });

  if (version !== null) {
    if (version !== MODERN) return failure(400, id, -32022, 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: version });
    const expected: Array<[string, unknown]> = [['MCP-Protocol-Version', version], ['Mcp-Method', method], ...(method === 'tools/call' ? [['Mcp-Name', params.name] as [string, unknown]] : [])];
    for (const [name, value] of expected) if (header(request, name) !== value) return failure(400, id, -32020, `Header mismatch: ${name} header value '${header(request, name) ?? ''}' does not match body value '${String(value)}'`);
    const complete = (result: Record<string, unknown>) => ok({ resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER } });
    if (method === 'server/discover') return complete({ supportedVersions: [MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'private' });
    if (method === 'tools/list') return complete({ tools: TOOLS, ttlMs: 3_600_000, cacheScope: 'private' });
    if (method === 'tools/call') return complete(await callTool(env, connection, params));
    return failure(404, id, -32601, 'Method not found');
  }

  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '');
    return ok({ protocolVersion: LEGACY.includes(requested) ? requested : LEGACY[0], capabilities: { tools: {} }, serverInfo: SERVER, instructions: INSTRUCTIONS });
  }
  const announced = request.headers.get('MCP-Protocol-Version');
  if (announced && !LEGACY.includes(announced)) return failure(400, id, announced === MODERN ? -32020 : -32022, announced === MODERN ? `Header mismatch: the body has no ${VERSION_FIELD}` : 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: announced });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') return ok(await callTool(env, connection, params));
  return failure(200, id, -32601, 'Method not found');
}
