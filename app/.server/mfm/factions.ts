/** The Field Manual's faction pages, and which one a list's faction belongs to. */
import { norm } from "~/domain/text"

export const MFM_BASE_URL = "https://mfm.warhammer-community.com/en"

/** Page slugs, as linked from the Field Manual's index (read 2 October 2026). */
export const MFM_SLUGS = [
  "adepta-sororitas",
  "adeptus-custodes",
  "adeptus-mechanicus",
  "aeldari",
  "astra-militarum",
  "black-templars",
  "blood-angels",
  "chaos-daemons",
  "chaos-knights",
  "chaos-space-marines",
  "chaos-titan-legions",
  "dark-angels",
  "death-guard",
  "deathwatch",
  "drukhari",
  "emperors-children",
  "genestealer-cults",
  "grey-knights",
  "imperial-agents",
  "imperial-knights",
  "leagues-of-votann",
  "necrons",
  "orks",
  "space-marines",
  "space-wolves",
  "tau-empire",
  "thousand-sons",
  "titan-legions",
  "tyranids",
  "world-eaters"
] as const

export type MfmSlug = (typeof MFM_SLUGS)[number]

export const isMfmSlug = (s: string): s is MfmSlug => (MFM_SLUGS as ReadonlyArray<string>).includes(s)

export const mfmUrl = (slug: string) => `${MFM_BASE_URL}/${slug}`

/** Faction names that don't have a page of their own, as rosters and text exports write them. */
const ALIASES: Record<string, MfmSlug> = {
  asuryani: "aeldari",
  ynnari: "aeldari",
  harlequins: "aeldari",
  craftworlds: "aeldari",
  "adeptus astartes": "space-marines",
  // 40k.app writes Chaos Space Marines lists as Heretic Astartes
  "heretic astartes": "chaos-space-marines",
  // chapters priced on the Space Marines page (the others have their own)
  "white scars": "space-marines",
  ultramarines: "space-marines",
  "imperial fists": "space-marines",
  "iron hands": "space-marines",
  "raven guard": "space-marines",
  salamanders: "space-marines"
}

/** The Field Manual page that prices a list of this faction, if there is one. */
export function fieldManualSlug(faction: string | undefined | null): MfmSlug | null {
  const key = norm(faction)
  if (!key) return null
  if (ALIASES[key]) return ALIASES[key]
  const slug = key.replace(/ /g, "-")
  return isMfmSlug(slug) ? slug : null
}
