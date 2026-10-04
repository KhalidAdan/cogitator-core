/**
 * A Model Context Protocol server over Streamable HTTP, as much of it as a
 * tools-only, read-only server needs: `initialize`, `ping`, `tools/list` and
 * `tools/call`, stateless (no sessions), one JSON response per POST and no
 * server-sent events.
 *
 * It is written here rather than taken from the official SDK because the SDK
 * brings an HTTP framework and a JSON Schema compiler that generates code,
 * which Workers don't allow. tests/mcp.test.ts connects the SDK's own client
 * to it, so the two are known to agree.
 */

import { noteUsage } from "../usage"

/** A JSON Schema for a tool's arguments. */
export type JsonSchema = Readonly<Record<string, unknown>>

export interface ToolResult {
  /** What the agent reads. */
  readonly text: string
  /** The same, as data, for clients that use it. */
  readonly data?: Readonly<Record<string, unknown>>
  readonly isError?: boolean
}

export interface McpTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly call: (args: Readonly<Record<string, unknown>>) => Promise<ToolResult>
}

export interface McpServer {
  readonly name: string
  readonly title: string
  readonly version: string
  /** Shown to the agent when it connects: what the server is for and how to start. */
  readonly instructions: string
  readonly tools: ReadonlyArray<McpTool>
}

/** Protocol versions this server can speak, newest first. */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

/** Agents call from anywhere, including browser-based clients; nothing here uses cookies. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id"
}

type Message = Record<string, unknown>
const isObject = (v: unknown): v is Message => !!v && typeof v === "object" && !Array.isArray(v)

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
  const text = JSON.stringify(body)
  noteUsage({ bytes: text.length })
  return new Response(text, { status, headers: { "Content-Type": "application/json", ...CORS, ...headers } })
}
const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value })
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

/** The text of an error thrown by a tool, including the `data()` responses `run` throws for known failures. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (isObject(e) && isObject(e.data) && typeof e.data.message === "string") return e.data.message
  return String(e)
}

export async function serveMcp(request: Request, server: McpServer): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (request.method !== "POST") {
    return reply(failure(null, -32000, "This server takes JSON-RPC over POST and keeps no sessions or event streams."), 405, { Allow: "POST, OPTIONS" })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return reply(failure(null, -32700, "Parse error: the body isn't JSON."), 400)
  }
  // a batch is answered as one; the 2025-06-18 protocol no longer sends them, older clients may
  const messages = Array.isArray(body) ? body : [body]
  const answers: Array<unknown> = []
  for (const m of messages) {
    const a = await handle(m, server)
    if (a) answers.push(a)
  }
  // only notifications or responses: nothing to say back
  if (!answers.length) return new Response(null, { status: 202, headers: CORS })
  return reply(Array.isArray(body) ? answers : answers[0])
}

async function handle(m: unknown, server: McpServer): Promise<unknown> {
  if (!isObject(m) || m.jsonrpc !== "2.0") return failure(null, -32600, "Invalid request: expected a JSON-RPC 2.0 message.")
  // a response to something the server asked (it asks nothing), or a notification
  if (typeof m.method !== "string" || m.id === undefined) return null
  const id = m.id
  const params = isObject(m.params) ? m.params : {}
  noteUsage({ tool: m.method === "tools/call" ? String(params.name) : m.method })
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      return result(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, title: server.title, version: server.version },
        instructions: server.instructions
      })
    }
    case "ping":
      return result(id, {})
    case "tools/list":
      return result(id, {
        tools: server.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        }))
      })
    case "tools/call": {
      const tool = server.tools.find((t) => t.name === params.name)
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(params.name)}`)
      const started = Date.now()
      try {
        const r = await tool.call(isObject(params.arguments) ? params.arguments : {})
        console.log(`mcp ${tool.name} ${Date.now() - started}ms${r.isError ? " (error)" : ""}`)
        return result(id, {
          content: [{ type: "text", text: r.text }],
          ...(r.data ? { structuredContent: r.data } : {}),
          ...(r.isError ? { isError: true } : {})
        })
      } catch (e) {
        // a failed call is the tool's answer, not a protocol error, so the agent can read it and try again
        console.log(`mcp ${tool.name} ${Date.now() - started}ms (failed)`)
        return result(id, { content: [{ type: "text", text: errorText(e) }], isError: true })
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${m.method}`)
  }
}
