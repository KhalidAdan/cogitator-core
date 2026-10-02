/**
 * Read the text of a Next.js page out of its embedded data, in document order.
 *
 * The Munitorum Field Manual is a Next.js app that streams its content: the
 * raw HTML has the pieces out of order (placeholders filled in by script), so
 * stripping tags gives every unit name first and every price afterwards. The
 * same content is also embedded as React's "flight" payload, a list of rows
 * of JSON that reference each other. Walking that from the root gives the
 * page's text in the order a reader sees it, with no HTML parsing at all.
 *
 * Nothing here knows about points; it turns a page into a list of strings.
 */

/** `self.__next_f.push([1,"…"])`: each call carries one chunk of the payload as a JS string literal. */
const PUSH = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g

export function flightPayload(html: string): string {
  let out = ""
  for (const m of html.matchAll(PUSH)) out += JSON.parse(`"${m[1]}"`) as string
  return out
}

/**
 * Split a payload into its rows. A row is `<hex id>:<body>\n`; bodies that are
 * JSON are kept, and the rest (module imports, preload hints) are skipped.
 * Text rows (`T<byte length in hex>,<text>`) are length-prefixed and may
 * contain newlines.
 */
export function flightRows(payload: string): Map<string, unknown> {
  const rows = new Map<string, unknown>()
  const head = /([0-9a-f]*):/y
  let i = 0
  while (i < payload.length) {
    if (payload[i] === "\n") {
      i++
      continue
    }
    head.lastIndex = i
    const m = head.exec(payload)
    if (!m) break
    let j = head.lastIndex
    if (payload[j] === "T") {
      const comma = payload.indexOf(",", j)
      let bytes = parseInt(payload.slice(j + 1, comma), 16)
      j = comma + 1
      const start = j
      while (bytes > 0 && j < payload.length) {
        const cp = payload.codePointAt(j)!
        bytes -= cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
        j += cp > 0xffff ? 2 : 1
      }
      rows.set(m[1], payload.slice(start, j))
      i = j
      continue
    }
    let end = payload.indexOf("\n", j)
    if (end < 0) end = payload.length
    try {
      rows.set(m[1], JSON.parse(payload.slice(j, end)))
    } catch {
      // not a JSON row (I[…] import, HL[…] hint, …): nothing a reader would see
    }
    i = end + 1
  }
  return rows
}

const LAZY = /^\$L([0-9a-f]+)$/

/** Every piece of text in the tree under row 0, in document order. */
export function flightTokens(rows: ReadonlyMap<string, unknown>): Array<string> {
  const tokens: Array<string> = []
  const seen = new Set<string>()
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      const lazy = LAZY.exec(v)
      if (lazy) {
        // a reference to another row: its content belongs here, once
        if (rows.has(lazy[1]) && !seen.has(lazy[1])) {
          seen.add(lazy[1])
          walk(rows.get(lazy[1]))
        }
        return
      }
      // "$…" strings are other kinds of reference; a literal leading "$" is written "$$"
      const text = (v.startsWith("$$") ? v.slice(1) : v.startsWith("$") ? "" : v).trim()
      if (text) tokens.push(text)
      return
    }
    if (Array.isArray(v)) {
      // a React element is ["$", type, key, props]
      if (v[0] === "$" && v.length >= 4 && v[3] && typeof v[3] === "object") walk((v[3] as { children?: unknown }).children)
      else for (const x of v) walk(x)
      return
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      if ("children" in o) walk(o.children)
      if ("f" in o) walk(o.f)
    }
  }
  walk(rows.get("0"))
  return tokens
}

/** A page's visible text, in reading order. */
export const pageTokens = (html: string): Array<string> => flightTokens(flightRows(flightPayload(html)))
