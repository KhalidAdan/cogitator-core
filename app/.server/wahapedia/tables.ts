/**
 * The Wahapedia data export, as a registry: one entry per CSV file we load.
 *
 * Columns are taken from "Export Data Specs.xlsx" (11th edition, v20260817b)
 * and were checked against the 2026-09-28 export. Everything downstream — the
 * migration that creates the tables, the loader, the change report — is driven
 * from this list, so a spec change is a one-file edit.
 *
 * `key` identifies a record for diffing between snapshots. The export has no
 * declared keys and a few files repeat rows, so the diff treats a key as a
 * small bag of rows rather than assuming uniqueness.
 */
export interface WhTable {
  /** File name without `.csv`. */
  readonly file: string
  /** SQLite table name. */
  readonly table: string
  readonly columns: ReadonlyArray<string>
  readonly key: ReadonlyArray<string>
  /** Human label for the change report. */
  readonly label: string
}

export const WH_TABLES: ReadonlyArray<WhTable> = [
  { file: "Factions", table: "wh_factions", label: "Factions", columns: ["id", "name", "link"], key: ["id"] },
  {
    file: "Source",
    table: "wh_sources",
    label: "Sources",
    columns: ["id", "name", "type", "edition", "version", "errata_date", "errata_link"],
    key: ["id"]
  },
  {
    file: "Datasheets",
    table: "wh_datasheets",
    label: "Datasheets",
    columns: [
      "id",
      "name",
      "faction_id",
      "source_id",
      "legend",
      "role",
      "loadout",
      "transport",
      "virtual",
      "is_support",
      "leader_head",
      "leader_footer",
      "damaged_w",
      "damaged_description",
      "link"
    ],
    key: ["id"]
  },
  {
    file: "Datasheets_abilities",
    table: "wh_datasheet_abilities",
    label: "Datasheet abilities",
    columns: ["datasheet_id", "line", "ability_id", "model", "name", "description", "type", "parameter"],
    // not `line`: inserting one ability renumbers the rest and would read as a wall of changes
    key: ["datasheet_id", "ability_id", "name"]
  },
  {
    file: "Datasheets_keywords",
    table: "wh_datasheet_keywords",
    label: "Keywords",
    columns: ["datasheet_id", "keyword", "model", "is_faction_keyword"],
    key: ["datasheet_id", "keyword", "model"]
  },
  {
    file: "Datasheets_models",
    table: "wh_datasheet_models",
    label: "Model profiles",
    columns: ["datasheet_id", "line", "name", "M", "T", "Sv", "inv_sv", "inv_sv_descr", "W", "Ld", "OC", "base_size", "base_size_descr"],
    key: ["datasheet_id", "name"]
  },
  {
    file: "Datasheets_options",
    table: "wh_datasheet_options",
    label: "Wargear options",
    columns: ["datasheet_id", "line", "button", "description"],
    key: ["datasheet_id", "line"]
  },
  {
    file: "Datasheets_wargear",
    table: "wh_datasheet_wargear",
    label: "Weapon profiles",
    columns: ["datasheet_id", "line", "line_in_wargear", "dice", "name", "description", "range", "type", "A", "BS_WS", "S", "AP", "D"],
    // `line` is blank on datasheets shared between factions, so it can't be part of the key
    key: ["datasheet_id", "name", "type", "line_in_wargear"]
  },
  {
    file: "Datasheets_unit_composition",
    table: "wh_datasheet_unit_composition",
    label: "Unit composition",
    columns: ["datasheet_id", "line", "description"],
    key: ["datasheet_id", "line"]
  },
  {
    file: "Datasheets_models_cost",
    table: "wh_datasheet_models_cost",
    label: "Points",
    columns: ["datasheet_id", "line", "description", "cost"],
    key: ["datasheet_id", "line"]
  },
  {
    file: "Datasheets_enhancements",
    table: "wh_datasheet_enhancements",
    label: "Datasheet enhancements",
    columns: ["datasheet_id", "enhancement_id"],
    key: ["datasheet_id", "enhancement_id"]
  },
  {
    file: "Datasheets_detachment_abilities",
    table: "wh_datasheet_detachment_abilities",
    label: "Datasheet detachment abilities",
    columns: ["datasheet_id", "detachment_ability_id"],
    key: ["datasheet_id", "detachment_ability_id"]
  },
  {
    file: "Datasheets_leader",
    table: "wh_datasheet_leaders",
    label: "Leader attachments",
    columns: ["leader_id", "attached_id"],
    key: ["leader_id", "attached_id"]
  },
  {
    file: "Abilities",
    table: "wh_abilities",
    label: "Shared abilities",
    columns: ["id", "name", "legend", "faction_id", "description"],
    key: ["id", "faction_id"]
  },
  {
    file: "Enhancements",
    table: "wh_enhancements",
    label: "Enhancements",
    columns: ["faction_id", "name", "id", "cost", "detachment", "detachment_id", "upgrade", "legend", "description", "support_leader"],
    key: ["id"]
  },
  {
    file: "Detachment_abilities",
    table: "wh_detachment_abilities",
    label: "Detachment abilities",
    columns: ["id", "faction_id", "name", "legend", "description", "detachment", "detachment_id"],
    key: ["id"]
  },
  {
    file: "Detachments",
    table: "wh_detachments",
    label: "Detachments",
    columns: ["id", "faction_id", "name", "legend", "type", "dp", "force_disposition"],
    key: ["id"]
  },
  {
    file: "Detachments_chapter_dp",
    table: "wh_detachment_chapter_dp",
    label: "Chapter detachment points",
    columns: ["detachment_id", "keyword", "dp"],
    key: ["detachment_id", "keyword"]
  }
]

/**
 * Files in the export that are downloaded and kept, but not loaded into the
 * database: stratagems are deliberately outside the maths (handoff section 1).
 */
export const WH_SKIPPED_FILES = ["Stratagems", "Datasheets_stratagems"] as const

/** Single-row file holding the export's own timestamp (GMT+3). */
export const WH_LAST_UPDATE_FILE = "Last_update"

/** Every file the fetch script downloads. */
export const WH_ALL_FILES: ReadonlyArray<string> = [WH_LAST_UPDATE_FILE, ...WH_TABLES.map((t) => t.file), ...WH_SKIPPED_FILES]

export const WH_BASE_URL = "https://wahapedia.ru/wh40k11ed"
export const WH_EXPORT_PAGE = `${WH_BASE_URL}/the-rules/data-export`

/** Export column names double as SQLite column names; always quote them (`virtual`, `type`…). */
export const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`

export const whTableByFile = (file: string) => WH_TABLES.find((t) => t.file === file)
