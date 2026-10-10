/** Name normalisation shared by the importer, the Wahapedia mapper and the UI. */

/** Lower case, accents and apostrophes dropped, punctuation collapsed to single spaces. */
export const norm = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/\(upgrade\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

export const slug = (s: unknown): string => norm(s).replace(/ /g, "-") || "x"

/** A normalised rule name without its number: "damaged 4", "deadly demise d3", "scouts 7" → "damaged", "deadly demise", "scouts". */
export const baseRuleName = (k: string): string => k.replace(/ (d?\d+|x)$/, "").replace(/ once per .*$/, "").trim()

/** Roster text: bold markers out, odd hyphens normalised, whitespace collapsed. */
export const clean = (s: unknown): string =>
  String(s ?? "")
    .replace(/\*\*/g, "")
    .replace(/‑|‐/g, "-")
    .replace(/\s+/g, " ")
    .trim()

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"])

/** All-caps list names read better in title case; anything already mixed-case is left alone. */
export const titleCase = (s: string): string =>
  s !== s.toUpperCase()
    ? s
    : s
        .toLowerCase()
        .split(" ")
        .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ")

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" }

/** Wahapedia rule text arrives as site HTML; this is the readable plain-text form. */
export const stripHtml = (html: unknown): string =>
  String(html ?? "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|tr|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

/** Stable short hash of rule text, for spotting wording changes between snapshots. */
export function textHash(s: string): string {
  // FNV-1a, 32 bit; whitespace and case are not meaningful differences in rules text
  let h = 0x811c9dc5
  const t = s.toLowerCase().replace(/\s+/g, " ").trim()
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}
