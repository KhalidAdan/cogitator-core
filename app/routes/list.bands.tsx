/** Coverage by toughness band: the matrix's targets grouped by Toughness, and how many units really hurt each group. */
import { useMemo } from "react"
import { Link, useSearchParams } from "react-router"
import { f1, useLedger } from "~/components/ledger"
import { BAND_MIN, type BandCell, type BandNote, type BandTest, bandNotes, bandView, PUNCH, pointsRemoved, punchLine } from "~/domain/bands"
import type { AttackResult } from "~/domain/engine"
import { EFFICIENT, heat, matrix, phaseLabel, sectionOf, unitSub } from "~/domain/ledger"
import type { Target, Unit } from "~/domain/schema"

const TESTS: ReadonlyArray<readonly [BandTest, string]> = [
  ["removes", `Removes ${PUNCH}+ pts`],
  ["return", `Returns ${EFFICIENT}%+`]
]

export default function BandsView() {
  const ledger = useLedger()
  const { opts, groups, action } = ledger
  const [search] = useSearchParams()
  const test: BandTest = search.get("by") === "return" ? "return" : "removes"
  const m = useMemo(() => matrix(ledger), [ledger])
  const v = useMemo(() => bandView(m, test), [m, test])
  const notes = useMemo(() => bandNotes(v), [v])
  const column = useMemo(() => new Map(m.targets.map((t, k) => [t.id, k])), [m])

  let last: string | null = null
  return (
    <>
      <div className="legend">
        <div className="eq">At least {BAND_MIN} units that really hurt every toughness band</div>
        <div className="keyrow">
          <span className="seg sm" role="group" aria-label="What counts as hurting a target">
            {TESTS.map(([k, label]) => (
              <Link key={k} to={k === "removes" ? "." : `?by=${k}`} preventScrollReset replace aria-current={k === test ? "true" : undefined}>
                {label}
              </Link>
            ))}
          </span>
          <span>
            {test === "removes"
              ? `A unit hurts a target when one activation removes ${PUNCH} of its points, or all of it when it’s worth less.`
              : `A unit hurts a target when it earns back ${EFFICIENT}% of its own cost against it, the matrix’s efficient line.`}{" "}
            It covers a band when it hurts at least half the band’s targets. {phaseLabel(opts.phase)}.
          </span>
        </div>
        <div className="keyrow">
          <span>
            <span className="sw" style={{ background: heat(80).bg }} />
            covers the band
          </span>
          <span>
            <span className="sw" style={{ background: heat(50).bg }} />
            hurts some of it
          </span>
          <span>One dot per target, filled where the unit hurts it.</span>
        </div>
      </div>
      <div className="mx-scroll">
        <table className="mx bands">
          <thead>
            <tr>
              <th className="rowh corner">Your unit, then band</th>
              {v.columns.map((c) => (
                <th key={c.band.id} className="band">
                  <span className="bl">{c.band.label}</span>
                  {c.targets.length ? (
                    c.targets.map((t) => (
                      <Link key={t.id} to={`${action}/targets/${t.id}`} prefetch="intent" className="bt">
                        {t.nm}
                      </Link>
                    ))
                  ) : (
                    <span className="bt none">no targets</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.flatMap(({ unit: u, cells }, i) => {
              const sec = sectionOf(u, groups)
              const out = []
              if (sec !== last) {
                out.push(
                  <tr className="sec" key={`sec-${sec}`}>
                    <td colSpan={v.columns.length + 1}>{sec}</td>
                  </tr>
                )
                last = sec
              }
              out.push(
                <tr key={u.id}>
                  <td className="rowh">
                    <Link to={`${action}/units/${u.id}`} prefetch="intent">
                      <span className="un">{u.nm}</span>
                      <span className="um">{unitSub(u, opts)}</span>
                    </Link>
                  </td>
                  {cells.map((cell, j) => (
                    <BandTd
                      key={v.columns[j].band.id}
                      unit={u}
                      base={action}
                      cell={cell}
                      targets={v.columns[j].targets}
                      results={v.columns[j].targets.map((t) => m.rows[i].cells[column.get(t.id)!])}
                      test={test}
                    />
                  ))}
                </tr>
              )
              return out
            })}
            <tr className="cov">
              <td className="rowh">Units that cover the band</td>
              {v.columns.map((c) => (
                <td key={c.band.id} className={c.targets.length && c.units.length < BAND_MIN ? "zero" : ""}>
                  {c.targets.length ? c.units.length : "–"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="findings">
        {notes.map((n, i) => (
          <NoteItem key={i} n={n} />
        ))}
      </ul>
    </>
  )
}

function BandTd({
  unit,
  base,
  cell,
  targets,
  results,
  test
}: {
  unit: Unit
  /** The list's own path, which links start from. */
  base: string
  cell: BandCell
  targets: ReadonlyArray<Target>
  /** The matrix's results against `targets`, in the same order. */
  results: ReadonlyArray<AttackResult>
  test: BandTest
}) {
  if (!targets.length) return <td className="c" />
  const some = cell.hits.some(Boolean)
  const h = heat(cell.covers ? 80 : some ? 50 : 0)
  const line = (t: Target, i: number) => {
    const c = results[i]
    const got = test === "removes" ? `${Math.round(pointsRemoved(c))} of ${punchLine(t)} pts` : `${f1(c.roi)}%`
    return `${cell.hits[i] ? "✓" : "✗"} ${t.nm}: ${got}`
  }
  return (
    <td className={`c ${cell.covers ? "eff" : ""}`}>
      <Link
        to={`${base}/units/${unit.id}?vs=${targets[cell.best].id}`}
        style={{ background: h.bg, color: h.fg }}
        title={[unit.nm, ...targets.map(line)].join("\n")}
        aria-label={`${unit.nm}: hurts ${cell.hits.filter(Boolean).length} of ${targets.length}`}
      >
        <span className="dots">
          {cell.hits.map((hit, i) => (
            <i key={i} className={hit ? "on" : undefined} />
          ))}
        </span>
      </Link>
    </td>
  )
}

const unitLink = (u: Unit) => <Link to={`units/${u.id}`}>{u.nm}</Link>

function NoteItem({ n }: { n: BandNote }) {
  switch (n.kind) {
    case "covered":
      return (
        <li className="gold">
          Every band has at least {BAND_MIN} units that hurt it. The thinnest is <b>{n.thinnest.label}</b>, with {n.count}.
        </li>
      )
    case "thin":
      return (
        <li className="alert">
          {n.units.length ? (
            <>
              Only {unitLink(n.units[0])} covers <b>{n.band.words}</b> targets.
            </>
          ) : (
            <>
              Nothing covers <b>{n.band.words}</b> targets.
            </>
          )}
          {n.closest ? (
            n.closest.hit ? (
              <>
                {" "}
                {n.units.length ? "Next" : "Closest"} is {unitLink(n.closest.unit)}, hurting {n.closest.hit} of its {n.closest.of}.
              </>
            ) : (
              <>
                {" "}
                {n.units.length ? "Nothing else" : "Nothing"} hurts any of them; {unitLink(n.closest.unit)} comes closest.
              </>
            )
          ) : null}
        </li>
      )
    case "single":
      return (
        <li>
          <b>{n.band.label}</b> is judged on one target, <Link to={`targets/${n.target.id}`}>{n.target.nm}</Link>. Another from the{" "}
          <Link to="/database/datasheets">datasheet browser</Link> would make it a steadier read.
        </li>
      )
    case "empty":
      return (
        <li>
          No benchmark target is {n.band.words}, so that band isn’t checked. Add one from the{" "}
          <Link to="/database/datasheets">datasheet browser</Link>.
        </li>
      )
  }
}
