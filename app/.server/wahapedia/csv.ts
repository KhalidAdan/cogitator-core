/**
 * Parser for the Wahapedia export's CSV dialect.
 *
 * The files are `|`-delimited with a trailing `|` on every record, UTF-8 with a
 * BOM, and **unquoted**: HTML fields contain raw newlines (see Abilities.csv).
 * So records cannot be found by splitting on lines. Instead the whole file is
 * split on `|` and cut into records of the header's width; every record after
 * the header must then begin with the newline that ended the previous one,
 * which is what makes a mis-cut detectable.
 */
import { Effect, Schema } from "effect"

export class CsvShapeError extends Schema.TaggedError<CsvShapeError>()("CsvShapeError", {
  file: Schema.String,
  message: Schema.String
}) {}

export interface ParsedCsv {
  readonly columns: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
}

export function parseExportCsvSync(file: string, text: string): ParsedCsv {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const eol = body.indexOf("\n")
  const header = (eol < 0 ? body : body.slice(0, eol)).replace(/\r$/, "")
  if (!header.endsWith("|")) throw new CsvShapeError({ file, message: "The header row doesn’t end with “|”; this isn’t a Wahapedia export file." })
  const columns = header.slice(0, -1).split("|")
  const width = columns.length
  const tokens = body.split("|")
  // header (width tokens) + records (width tokens each) + whatever follows the last "|"
  const tail = tokens[tokens.length - 1]
  if ((tokens.length - 1) % width !== 0 || tail.trim() !== "") {
    throw new CsvShapeError({
      file,
      message: `Expected records of ${width} fields, but the file doesn’t divide evenly. A field probably contains a “|”.`
    })
  }
  const rows: Array<Array<string>> = []
  for (let i = width; i < tokens.length - 1; i += width) {
    const first = tokens[i]
    if (first[0] !== "\n" && !(first[0] === "\r" && first[1] === "\n")) {
      throw new CsvShapeError({ file, message: `Record ${rows.length + 1} doesn’t start on a new line; the columns are misaligned.` })
    }
    const row = tokens.slice(i, i + width)
    row[0] = first.replace(/^\r?\n/, "")
    rows.push(row)
  }
  return { columns, rows }
}

export const parseExportCsv = (file: string, text: string) =>
  Effect.try({
    try: () => parseExportCsvSync(file, text),
    catch: (e) => (e instanceof CsvShapeError ? e : new CsvShapeError({ file, message: String(e) }))
  })
