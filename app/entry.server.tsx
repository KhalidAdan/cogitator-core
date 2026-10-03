/**
 * Server rendering on Cloudflare: web streams (`renderToReadableStream`), since
 * Workers have no Node streams. Crawlers get the whole page at once; browsers
 * get it streamed.
 */
import { isbot } from "isbot"
import { renderToReadableStream } from "react-dom/server"
import type { EntryContext } from "react-router"
import { ServerRouter } from "react-router"

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  let shellRendered = false
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    onError(error: unknown) {
      responseStatusCode = 500
      // errors before the shell is ready reject the render and reach the error boundary; after it, log them
      if (shellRendered) console.error(error)
    }
  })
  shellRendered = true

  const userAgent = request.headers.get("user-agent")
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) await body.allReady

  responseHeaders.set("Content-Type", "text/html")
  return new Response(body, { headers: responseHeaders, status: responseStatusCode })
}
