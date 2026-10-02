// One-off: turn the POC's data files into the seed this app loads on first run.
//
//   node scripts/poc-export.mjs
//
// Reads kill-ledger/src/{data,extra_lists}.js and writes app/.server/seed/poc-seed.json.
// The output is checked in; this script is kept so the provenance of every seeded
// rule, list and target is reproducible. The only edits made on the way through
// are the ones described in docs/decisions.md (rules as data, marks as data).
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = ["data.js", "extra_lists.js"].map((f) => readFileSync(join(root, "kill-ledger/src", f), "utf8")).join("\n")
const poc = vm.runInNewContext(
  src +
    ";({BASE_RULES, DEFAULT_UNITS, DEFAULT_TARGETS, DEFAULT_OPTS, BUILTIN_META, BUILTIN_GROUPS, BUILTIN_ARMY_RULES, ARMY_RULE_SCOPE, EXTRA_BUILTIN_LISTS, FACTION_ARMY_RULES, DETACHMENT_RULES, DETACHMENT_UNIT_GRANTS, COGITATOR_RULES_OFF})",
  { module: undefined }
)
const clone = (o) => JSON.parse(JSON.stringify(o))

// ---- rules: the POC's by-name engine branches (LEGACY_FX) and hardcoded marks, restated as fx ----
const FX = {
  "assassins-eye": [{ phase: "ranged", when: "char", ap: 1 }],
  "piratical-hero": [{ hit: 1, grant: { sus: 1 } }],
  assured: [{ phase: "ranged", vs: { only: ["MONSTER", "VEHICLE"] }, rrHit: "all", rrWound: "all", rrDmg: true }],
  reavers: [
    { whenNot: "objective", rrHit: "ones" },
    { when: "objective", rrHit: "all" }
  ],
  raiders: [{ grant: { lethal: 1 } }],
  "spirit-marked": [{ grant: { sus: 1 } }],
  psyguide: [{ hit: 1 }],
  faolchu: [{ phase: "ranged", grant: { ic: 1 } }],
  // marks the POC applied from opts.riven / opts.web / opts.guide
  "fury-void": [{ s: 1 }],
  "whispering-web": [{ critHit: 5 }],
  guide: [{ hit: 1 }]
}
const GLOBAL_MARKS = new Set(["fury-void", "whispering-web", "guide"])
// [label, one-line effect] for the rule that sets each mark (was MARKS in app.js)
const MARK_LABELS = {
  "fury-void": ["Riven", "Fury of the Void: +1 Strength for every attack."],
  "whispering-web": ["Webbed", "Whispering Web: critical hits on 5+."],
  guide: ["Guided", "Guide: +1 to hit for every attack."],
  raiders: ["Raiders’ quarry", "Piratical Raiders: Lethal Hits for the unit and its leader."],
  "spirit-mark": ["Spirit-marked", "Spirit Mark: Sustained Hits 1 for the Wraith Constructs."],
  "shattered-defences": ["Shattered", "Shattered Defences: +1 AP for ranged attacks against a marked Monster or Vehicle."],
  hailstrike: ["Hailstrike-marked", "Hailstrike: ranged attacks against it ignore cover."]
}
// handoff section 6: text written mid-project and never checked against a rules source
const UNVERIFIED = new Set(["spearpoint-tf", "assault-brethren", "wrath-first-khan"])

const rules = {}
const status = {}
const faction = {}
// data.js lists the Aeldari library first, then Space Marines from "combat-doctrines" on
let currentFaction = "AE"
for (const [id, r0] of Object.entries(clone(poc.BASE_RULES))) {
  if (id === "combat-doctrines") currentFaction = "SM"
  faction[id] = currentFaction
  const r = { ...r0 }
  if (FX[id]) r.fx = FX[id]
  else if (r.fx) r.fx = [].concat(r.fx)
  if (!r.dmg) delete r.fx
  if (GLOBAL_MARKS.has(id)) r.global = true
  if (MARK_LABELS[id]) [r.markNm, r.markTxt] = MARK_LABELS[id]
  if (poc.ARMY_RULE_SCOPE[id]) r.reach = poc.ARMY_RULE_SCOPE[id]
  rules[id] = r
  status[id] = UNVERIFIED.has(id) ? "draft" : r.dmg ? "verified" : "note"
}

// ---- options ----
const { phase, combine, enh, cap, mods: _mods, ...flags } = clone(poc.DEFAULT_OPTS)
const opts = { phase, combine, enh, cap, flags, off: {}, mods: {} }

// ---- lists ----
const fixRule = (r) => {
  const out = { ...r }
  if (out.scope == null) delete out.scope
  return out
}
const lists = [
  {
    id: "builtin-burning-v1",
    meta: { ...poc.BUILTIN_META, faction: "Asuryani", detachments: ["Corsair Coterie", "Path of the Outcast"], mission: "Priority Assets" },
    groups: poc.BUILTIN_GROUPS,
    armyRules: poc.BUILTIN_ARMY_RULES,
    rules: {},
    units: poc.DEFAULT_UNITS
  },
  // Strike Force Cophasta is no longer shipped as a built-in list (its points are being corrected and it
  // will come back as an ordinary import). The tests still check the engine and importer against it,
  // reading it straight from the POC.
  ...poc.EXTRA_BUILTIN_LISTS.filter((L) => L.id !== "builtin-cophasta")
].map((L) => ({
  ...clone(L),
  rules: Object.fromEntries(Object.entries(clone(L.rules)).map(([k, v]) => [k, fixRule(v)]))
}))

const seed = {
  generatedFrom: "kill-ledger/src/data.js + extra_lists.js",
  rules,
  ruleStatus: status,
  ruleFaction: faction,
  targets: clone(poc.DEFAULT_TARGETS),
  opts,
  lists,
  defaultListId: "builtin-burning-v2",
  // lookups the roster importer needs
  factionArmyRules: clone(poc.FACTION_ARMY_RULES),
  detachmentRules: clone(poc.DETACHMENT_RULES),
  detachmentUnitGrants: clone(poc.DETACHMENT_UNIT_GRANTS),
  bareDatasheetRulesOff: clone(poc.COGITATOR_RULES_OFF)
}
const out = join(root, "app/.server/seed/poc-seed.json")
writeFileSync(out, JSON.stringify(seed, null, 1) + "\n")
console.log(`wrote ${out}: ${Object.keys(rules).length} rules, ${seed.targets.length} targets, ${lists.length} lists`)
