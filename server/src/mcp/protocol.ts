/** The Model Context Protocol over HTTP, without a session.
 *
 *  MCP is JSON-RPC 2.0 with a handshake and a few methods. Over the
 *  streamable HTTP transport a client POSTs one message and reads one
 *  answer; in the stateless form used here the server keeps nothing between
 *  requests and answers in plain JSON rather than opening an event stream,
 *  which is what a Worker can do well: every request is complete in itself,
 *  and any isolate can answer it.
 *
 *  This is written by hand rather than taken from the reference SDK: the
 *  surface a stateless tools-only server needs is five methods, the SDK's
 *  transport wants a Node server underneath and a schema compiler that Workers
 *  forbid, and a test can drive this with a `Request`. What a client may rely
 *  on is the spec, not the SDK — so this says which protocol versions it
 *  speaks and refuses nothing a spec-following client sends.
 */
import type { Millis } from '../../../app/src/lib/units.js';
import { InvalidArguments } from './args.js';

/** The revisions this server speaks. The newest is what it offers a client
 *  that asks for something it does not know. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

/** A JSON Schema, as far as a tool needs to write one. */
export type JsonSchema = Record<string, unknown>;

/** What a tool hands back: a text the model reads, the same thing as data
 *  for clients that keep it, and whether it is a failure. */
export interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}

/** One tool: what the model is told about it, and what it does. `run`
 *  receives the arguments untyped and reads them through `args.ts`. */
export interface ToolDef<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** Hints the spec lets a tool give about itself; a client may show them. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run(args: unknown, ctx: C): Promise<ToolResult>;
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  /** Shown to the model when it connects: how the tools are meant to be used. */
  instructions: string;
  /** The path, on this server's own origin, of an SVG a client may show for
   *  it. It should fill its canvas: the connector's slot cuts its own shape
   *  and shows white around anything that does not (#50). */
  icon?: string;
}

/* JSON-RPC 2.0 */
type Id = string | number | null;
interface RpcRequest { jsonrpc: '2.0'; id?: Id; method: string; params?: unknown }
interface RpcResponse { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export const RPC = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });
const err = (id: Id, code: number, message: string, data?: unknown): RpcResponse =>
  ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });

const isRequest = (m: unknown): m is RpcRequest =>
  typeof m === 'object' && m !== null && (m as RpcRequest).jsonrpc === '2.0'
  && typeof (m as RpcRequest).method === 'string';

const param = (params: unknown, name: string): unknown =>
  typeof params === 'object' && params !== null ? (params as Record<string, unknown>)[name] : undefined;

/** The tool's own idea of what it returns, in the shape tools/list wants. */
const listed = <C>(t: ToolDef<C>): Record<string, unknown> => ({
  name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
  ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
  ...(t.annotations ? { annotations: { title: t.title, ...t.annotations } } : {}),
});

/** Answer one JSON-RPC request. Notifications answer nothing (null). */
async function dispatch<C>(
  msg: RpcRequest, tools: readonly ToolDef<C>[], info: ServerInfo, ctx: C, origin: string,
): Promise<RpcResponse | null> {
  const id = msg.id ?? null;
  const notification = msg.id === undefined;
  if (notification) return null;    /* initialized, cancelled, progress: noted, nothing owed */

  switch (msg.method) {
    case 'initialize': {
      const asked = param(msg.params, 'protocolVersion');
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(String(asked))
        ? String(asked) : LATEST_PROTOCOL;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: info.name, title: info.title, version: info.version,
          /* Since 2025-11-25 a server may say what it looks like; a client on
             an older revision ignores a field it does not know. */
          ...(info.icon ? { icons: [{ src: `${origin}${info.icon}`, mimeType: 'image/svg+xml', sizes: ['any'] }] } : {}),
        },
        instructions: info.instructions,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: tools.map(listed) });
    case 'tools/call': {
      const name = param(msg.params, 'name');
      const tool = tools.find((t) => t.name === name);
      if (!tool) return err(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      try {
        const result = await tool.run(param(msg.params, 'arguments'), ctx);
        return ok(id, {
          content: [{ type: 'text', text: result.text }],
          ...(result.structured ? { structuredContent: result.structured } : {}),
          isError: result.isError ?? false,
        });
      } catch (e) {
        if (e instanceof InvalidArguments) {
          return err(id, RPC.INVALID_PARAMS, `Invalid arguments for ${tool.name}: ${e.message}`);
        }
        /* Anything else is the tool failing at its job — the database, the
           catalogue — and is told to the model as a result, so it can say so
           to the learner instead of the call vanishing. */
        return ok(id, {
          content: [{ type: 'text', text: `${tool.name} failed: ${String((e as Error)?.message || e)}` }],
          isError: true,
        });
      }
    }
    default:
      return err(id, RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** One HTTP exchange with an authenticated client. POST carries messages;
 *  GET would open the server-to-client stream, which a stateless server has
 *  no use for, and DELETE would end a session there is none of. */
export async function serveMcp<C>(
  request: Request, tools: readonly ToolDef<C>[], info: ServerInfo, ctx: C,
  headers: Record<string, string> = {},
): Promise<Response> {
  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
  if (request.method === 'GET' || request.method === 'DELETE') {
    return new Response(null, { status: 405, headers: { ...headers, allow: 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...headers, allow: 'POST, OPTIONS' } });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(err(null, RPC.PARSE, 'Parse error: the body is not JSON'), 400);
  }
  /* A batch is a list of messages; the 2025-06-18 revision dropped them, but a
     client on the revision before may still send one, and answering it costs
     nothing. */
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length) return reply(err(null, RPC.INVALID_REQUEST, 'Invalid request: empty batch'), 400);
  const answers: RpcResponse[] = [];
  for (const m of messages) {
    if (!isRequest(m)) {
      /* A response from the client to a request this server never made, or
         garbage: the first is nothing to answer, the second is refused. */
      if (typeof m === 'object' && m !== null && 'id' in m && !('method' in m)) continue;
      answers.push(err(null, RPC.INVALID_REQUEST, 'Invalid request: not a JSON-RPC 2.0 message'));
      continue;
    }
    const answer = await dispatch(m, tools, info, ctx, new URL(request.url).origin);
    if (answer) answers.push(answer);
  }
  if (!answers.length) return new Response(null, { status: 202, headers });
  return reply(Array.isArray(body) ? answers : answers[0]);
}

/** Now, for the tools, as the app's unit. */
export const nowMs = (): Millis => Date.now() as Millis;
