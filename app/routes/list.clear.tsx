/** How much of each target one activation clears: units × benchmark targets, with the chance of a wipe in each cell. */
import { useMemo } from "react"
import { Link } from "react-router"
import { f1, useLedger } from "~/components/ledger"
import { type Clear, clearHeat, clearMatrix, type ClearNote, clearNotes, WIPES, wipes } from "~/domain/clear"
import { modIsSet } from "~/domain/engine"
import { heat, matrix, phaseLabel, rowModified, sectionOf, unitSub } from "~/domain/ledger"
import type { Target } from "~/domain/schema"

export default function ClearView() {
  const ledger = useLedger()
  const { opts, groups, action } = ledger
  const v = useMemo(() => clearMatrix(matrix(ledger)), [ledger])
  const notes = useMemo(() => clearNotes(v), [v])
  const veh = v.targets.length - v.infantry
  const colClass = (k: number) => (k === v.infantry && veh ? "first-veh" : k === 0 && v.infantry ? "first-inf" : "")

  let last: string | null = null
  return (
    <>
      <div className="legend">
        <div className="eq">
          <em>Average share cleared</em>, with the <em>chance of a wipe</em> beneath it
        </div>
        <div className="keyrow">
          <span>
            <span className="sw" style={{ background: heat(120).bg }} />
            wipes it more often than not
          </span>
          <span>
            <span className="sw" style={{ background: heat(80).bg }} />
            clears 65%+ on average
          </span>
          <span>
            <span className="sw" style={{ background: heat(50).bg }} />
            clears 35–64%
          </span>
        </div>
        <div className="keyrow">
          <span>
            {phaseLabel(opts.phase)}, one full activation into a full-strength target. Squads count by models, single models by wounds. Damage past a model’s last wound is lost, and the biggest
            hitters go first.
          </span>
        </div>
      </div>
      <div className="mx-scroll">
        <table className="mx clear">
          <thead>
            <tr className="grp">
              <th className="rowh" />
              {v.infantry ? (
                <th className="inf" colSpan={v.infantry}>
                  Infantry and beasts
                </th>
              ) : null}
              {veh ? (
                <th className="veh" colSpan={veh}>
                  Vehicles and monsters
                </th>
              ) : null}
              <th colSpan={2} />
            </tr>
            <tr>
              <th className="rowh corner">Your unit, then target</th>
              {v.targets.map((t, k) => (
                <th key={t.id} className={`tg ${colClass(k)}`}>
                  <Link to={`${action}/targets/${t.id}`} prefetch="intent">
                    <span className="tn">{t.nm}</span>
                    <span className="tm">{t.N > 1 ? `${t.N} models, W${t.W}` : `W${t.W}`}</span>
                  </Link>
                </th>
              ))}
              <th className="tg aggh">Wipes</th>
              <th className="tg aggh l">Most points off</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.flatMap(({ unit: u, cells, wiped, best }) => {
              const sec = sectionOf(u, groups)
              const out = []
              if (sec !== last) {
                out.push(
                  <tr className="sec" key={`sec-${sec}`}>
                    <td colSpan={v.targets.length + 3}>{sec}</td>
                  </tr>
                )
                last = sec
              }
              out.push(
                <tr key={u.id}>
                  <td className="rowh">
                    <Link to={`${action}/units/${u.id}`} prefetch="intent">
                      <span className="un">
                        {u.nm}
                        {rowModified(u, opts, modIsSet) ? <span className="modtag">modified</span> : null}
                      </span>
                      <span className="um">{unitSub(u, opts)}</span>
                    </Link>
                  </td>
                  {cells.map((c, k) => {
                    const t = v.targets[k]
                    const h = clearHeat(c)
                    return (
                      <td key={t.id} className={`c ${wipes(c) ? "eff" : ""} ${colClass(k)}`}>
                        <Link to={`${action}/units/${u.id}?vs=${t.id}`} style={{ background: h.bg, color: h.fg }} title={cellTitle(u.nm, t, c)}>
                          <span className="pc">{Math.round(c.cleared)}</span>
                          <span className="wp">{wipeLabel(c.wipe)}</span>
                        </Link>
                      </td>
                    )
                  })}
                  <td className="agg">{wiped}</td>
                  <td className="agg best" title={v.targets[best].nm}>
                    {v.targets[best].nm}
                  </td>
                </tr>
              )
              return out
            })}
            <tr className="cov">
              <td className="rowh">Units that wipe it {WIPES}%+</td>
              {v.coverage.map((n, k) => (
                <td key={v.targets[k].id} className={`${n === 0 ? "zero" : ""} ${colClass(k)}`}>
                  {n}
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="findings">
        {notes.map((n, i) => (
          <NoteItem key={i} n={n} base={action} />
        ))}
      </ul>
    </>
  )
}

/** The wipe chance as a cell shows it: never a flat 0 or 100 for something merely very likely or very unlikely. */
function wipeLabel(wipe: number): string {
  if (wipe <= 0) return "0%"
  if (wipe < 1) return "<1%"
  if (wipe > 99 && wipe < 100) return ">99%"
  return `${Math.round(wipe)}%`
}

function cellTitle(unit: string, t: Target, c: Clear): string {
  const removed = t.N > 1 ? `${f1(c.models)} of ${t.N} models on average` : `${f1(c.cleared)}% of its wounds on average`
  return `${unit} into ${t.nm}: clears ${removed}, ${f1(c.wipe)}% chance to wipe`
}

function NoteItem({ n, base }: { n: ClearNote; base: string }) {
  switch (n.kind) {
    case "covered":
      return <li>Every benchmark target has a unit that wipes it more often than not.</li>
    case "gap":
      return (
        <li className="alert">
          Nothing here reliably clears <Link to={`${base}/targets/${n.target.id}`}>{n.target.nm}</Link>. Your best shot is{" "}
          <Link to={`${base}/units/${n.unit.id}?vs=${n.target.id}`}>{n.unit.nm}</Link>, clearing <b>{Math.round(n.clear.cleared)}%</b> of it on average with a {wipeLabel(n.clear.wipe)} chance of a
          wipe{n.others > 0 ? `, and ${n.others} other target${n.others > 1 ? "s are" : " is"} under ${WIPES}% to wipe too` : ""}.
        </li>
      )
    case "top":
      return (
        <li className="gold">
          <Link to={`${base}/units/${n.unit.id}`}>{n.unit.nm}</Link> is your best clearer: it wipes{" "}
          <b>
            {n.count} of {n.of}
          </b>{" "}
          targets more often than not.
        </li>
      )
    case "none":
      return <li>No single unit here wipes any benchmark target more often than not.</li>
  }
}
