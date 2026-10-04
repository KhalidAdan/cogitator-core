/**
 * Which part of the app answers a request, inside the Durable Object: the MCP
 * endpoint, the OAuth server and its discovery documents, or the pages. Each
 * request is recorded in the usage log, whoever answers it.
 */
import { isAuthHttpPath, MCP_PATH, serveAuthHttp } from "./auth/auth"
import { serveCogitatorMcp } from "./mcp/server"
import { pageKind, recorded } from "./usage"

export function serveApp(request: Request, pages: (request: Request) => Promise<Response>): Promise<Response> {
  const path = new URL(request.url).pathname
  // the MCP endpoint for AI agents isn't a page: no cookies, no form checks, its own CORS (see ./mcp)
  if (path === MCP_PATH || path === `${MCP_PATH}/`) return recorded(request, "mcp", () => serveCogitatorMcp(request))
  // the OAuth server MCP clients sign in through, and its discovery documents (see ./auth)
  if (isAuthHttpPath(path)) return recorded(request, "oauth", () => serveAuthHttp(request))
  return recorded(request, pageKind(request), () => pages(request))
}
