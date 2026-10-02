/**
 * A minimal element tree over fast-xml-parser, with just the DOM-ish helpers
 * the roster importer needs (the POC used the browser's DOMParser).
 */
import { XMLParser, XMLValidator } from "fast-xml-parser"

export interface XNode {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: ReadonlyArray<XNode>
  /** Text directly inside this element. */
  readonly text: string
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true
})

function build(raw: any): XNode | null {
  const name = Object.keys(raw).find((k) => k !== ":@")
  if (!name || name === "#text" || name.startsWith("?")) return null
  const kids = Array.isArray(raw[name]) ? raw[name] : []
  const children: Array<XNode> = []
  let text = ""
  for (const k of kids) {
    if (k["#text"] !== undefined) text += String(k["#text"])
    else {
      const c = build(k)
      if (c) children.push(c)
    }
  }
  return { name, attrs: raw[":@"] ?? {}, children, text }
}

/** Parse a document and return its root element, or `null` when it is not well-formed XML. */
export function parseXml(xml: string): XNode | null {
  if (XMLValidator.validate(xml) !== true) return null
  for (const raw of parser.parse(xml)) {
    const n = build(raw)
    if (n) return n
  }
  return null
}

export const attr = (el: XNode | null | undefined, name: string): string | null => el?.attrs[name] ?? null
export const kids = (el: XNode | null | undefined, name: string): Array<XNode> => (el ? el.children.filter((c) => c.name === name) : [])
export const kid = (el: XNode | null | undefined, name: string): XNode | null => kids(el, name)[0] ?? null

/** Every descendant element with this name, in document order. */
export function descendants(el: XNode | null | undefined, name: string, out: Array<XNode> = []): Array<XNode> {
  if (!el) return out
  for (const c of el.children) {
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

/** All text beneath an element, like DOM `textContent`. */
export const textContent = (el: XNode): string => el.text + el.children.map(textContent).join("")
