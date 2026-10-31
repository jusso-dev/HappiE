import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const id = z.string().uuid();
const priority = z.enum(['required', 'normal', 'optional']).optional();
const child = { name: z.string().min(1), avatar_color: z.string().optional(), birth_year: z.number().int().optional(), storage_quota_mb: z.number().int().optional() };
const video = { title: z.string().min(1), description: z.string().optional(), category_id: id.nullable().optional(), approved: z.boolean().optional(), source_type: z.string().optional(), source_url: z.string().optional(), thumbnail_key: z.string().optional(), status: z.string().optional() };
const source = { name: z.string().min(1), source_url: z.string(), cron_schedule: z.string(), enabled: z.boolean().optional(), auto_approve: z.boolean().optional(), child_profile_ids: z.array(id).optional(), download_priority: priority, max_videos_per_poll: z.number().int().optional() };
const importOptions = { child_profile_ids: z.array(id).optional(), approve: z.boolean().optional(), download_priority: priority };

// Every tool is an explicit allowlisted dashboard operation. IDs are validated before
// interpolation and request bodies are forwarded to the existing API validation.
const operations = [
  ['list_children', 'List child profiles', {}, 'GET', '/children'],
  ['create_child', 'Create a child profile', child, 'POST', '/children'],
  ['update_child', 'Replace a child profile; supply all fields to retain', { id, ...child }, 'PUT', '/children/:id'],
  ['delete_child', 'Deactivate a child profile', { id }, 'DELETE', '/children/:id'],
  ['child_library', 'List a child’s assigned library', { id }, 'GET', '/children/:id/library'],
  ['list_videos', 'List videos, approval status and assignments', {}, 'GET', '/videos'],
  ['get_video', 'Get a video and its assignments', { id }, 'GET', '/videos/:id'],
  ['create_video', 'Create video metadata', video, 'POST', '/videos'],
  ['update_video', 'Replace video metadata; supply all fields to retain', { id, ...video }, 'PUT', '/videos/:id'],
  ['delete_video', 'Archive a video', { id }, 'DELETE', '/videos/:id'],
  ['assign_video', 'Assign or update a video for a child', { id, child_profile_id: id, download_priority: priority, expires_at: z.string().datetime().optional() }, 'POST', '/videos/:id/assign'],
  ['unassign_video', 'Remove a child’s video assignment', { id, child_id: id }, 'DELETE', '/videos/:id/assign/:child_id'],
  ['playback_url', 'Get a temporary playback URL for a video', { id }, 'GET', '/videos/:id/playback-url'],
  ['list_categories', 'List video categories', {}, 'GET', '/categories'],
  ['create_category', 'Create a video category', { name: z.string(), color: z.string().optional() }, 'POST', '/categories'],
  ['update_category', 'Update a video category', { id, name: z.string(), color: z.string().optional() }, 'PUT', '/categories/:id'],
  ['delete_category', 'Delete a video category', { id }, 'DELETE', '/categories/:id'],
  ['storage_summary', 'Show storage usage by video and source', {}, 'GET', '/storage/summary'],
  ['list_imports', 'List import and search jobs', {}, 'GET', '/imports'],
  ['get_import', 'Get import or YouTube search job status and results', { id }, 'GET', '/imports/:id'],
  ['cancel_import', 'Cancel an import job', { id }, 'POST', '/imports/:id/cancel'],
  ['retry_import', 'Retry a failed import job', { id }, 'POST', '/imports/:id/retry'],
  ['delete_import', 'Delete an import job', { id }, 'DELETE', '/imports/:id'],
  ['youtube_search', 'Queue a YouTube search; use get_import to retrieve results', { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }, 'POST', '/imports/youtube/search'],
  ['import_search_results', 'Import selected results from a completed YouTube search', { id, selected_external_ids: z.array(z.string()).min(1).max(50), ...importOptions }, 'POST', '/imports/youtube/search/:id/import'],
  ['import_youtube_url', 'Queue a YouTube video or playlist import', { url: z.string(), title: z.string().optional(), import_kind: z.enum(['video', 'playlist']).optional(), ...importOptions }, 'POST', '/imports/youtube/url'],
  ['list_video_sources', 'List scheduled YouTube sources', {}, 'GET', '/video-sources'],
  ['create_video_source', 'Create a scheduled YouTube source', source, 'POST', '/video-sources'],
  ['update_video_source', 'Replace a scheduled source; supply all fields to retain', { id, ...source }, 'PUT', '/video-sources/:id'],
  ['delete_video_source', 'Delete a scheduled source', { id }, 'DELETE', '/video-sources/:id'],
  ['poll_video_source', 'Poll a scheduled source now', { id }, 'POST', '/video-sources/:id/poll'],
];

export function createMcpServer(apiBase = process.env.HAPPIE_API_URL || 'http://happie-api:8080') {
  const server = new McpServer({ name: 'happie-admin', version: '1.0.0' });
  async function call(path, method, body) {
    const response = await fetch(new URL(path, apiBase), { method, ...(body instanceof FormData ? { body } : body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { content: [{ type: 'text', text: text || `HTTP ${response.status}` }], ...(response.ok ? {} : { isError: true }) };
  }
  for (const [name, description, schema, method, template] of operations) {
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: method === 'GET', destructiveHint: method === 'DELETE' } }, async (args) => {
      const body = { ...args };
      const path = template.replace(/:([a-z_]+)/g, (_, key) => { const value = body[key]; delete body[key]; return encodeURIComponent(value); });
      try { return await call(path, method, ['POST', 'PUT'].includes(method) ? body : undefined); }
      catch (error) { return { content: [{ type: 'text', text: `Happie API request failed: ${error.message}` }], isError: true }; }
    });
  }
  server.registerTool('upload_video', { description: 'Upload a video using base64 file content; the server optimizes it before returning.', inputSchema: { title: z.string().min(1), description: z.string().optional(), filename: z.string().min(1), content_type: z.string().optional(), content_base64: z.string().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false } }, async (args) => {
    try {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content_base64)) throw new Error('Invalid base64 content');
      const form = new FormData();
      form.set('title', args.title); form.set('description', args.description || '');
      form.set('file', new Blob([Buffer.from(args.content_base64, 'base64')], { type: args.content_type || 'application/octet-stream' }), args.filename);
      return await call('/uploads/direct', 'POST', form);
    } catch (error) { return { content: [{ type: 'text', text: `Upload failed: ${error.message}` }], isError: true }; }
  });
  return server;
}

export function createHttpServer(apiBase) {
  return createServer(async (req, res) => {
    // Browser origins are not needed by MCP clients and must not trigger admin actions.
    if (req.headers.origin) { res.writeHead(403).end(); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    const server = createMcpServer(apiBase);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: Number(process.env.MCP_MAX_REQUEST_BYTES || 268435456) });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  createHttpServer().listen(port, '0.0.0.0', () => console.log(`Happie MCP listening on ${port}`));
}
