/** The damage matrix: units × benchmark targets, with coverage and the auto-written findings. */
import { useMemo } from "react"
import { Link } from "react-router"
import { f1, useLedger } from "~/components/ledger"
import { modIsSet } from "~/domain/engine"
import { EFFICIENT, type Finding, findings, heat, matrix, phaseLabel, rowModified, sectionOf, unitSub } from "~/domain/ledger"
import type { Target } from "~/domain/schema"

export default function MatrixView() {
  const ledger = useLedger()
  const { opts, groups } = ledger
  const m = useMemo(() => matrix(ledger), [ledger])
  const notes = useMemo(() => findings(ledger, m), [ledger, m])
  const veh = m.targets.length - m.infantry
  const colClass = (k: number) => (k === m.infantry && veh ? "first-veh" : k === 0 && m.infantry ? "first-inf" : "")

  let last: string | null = null
  return (
    <>
      <div className="legend">
        <div className="eq">
          Return = <em>wounds dealt</em> ÷ <em>your points</em> × <em>their points per wound</em>
        </div>
        <div className="keyrow">
          <span>
            <span className="sw" style={{ background: heat(120).bg }} />
            100%+ pays for itself
          </span>
          <span>
            <span className="sw" style={{ background: heat(80).bg }} />
            {EFFICIENT}–99% efficient
          </span>
          <span>
            <span className="sw" style={{ background: heat(50).bg }} />
            35–64% chip damage
          </span>
          <span>{phaseLabel(opts.phase)}. Every damage rule in the list is applied unless you switch it off in the rules matrix.</span>
        </div>
      </div>
      <div className="mx-scroll">
        <table className="mx">
          <thead>
            <tr className="grp">
              <th className="rowh" />
              {m.infantry ? (
                <th className="inf" colSpan={m.infantry}>
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
              {m.targets.map((t, k) => (
                <th key={t.id} className={`tg ${colClass(k)}`}>
                  <Link to={`targets/${t.id}`} prefetch="intent">
                    <span className="tn">{t.nm}</span>
                    <span className="tm">
                      T{t.T}, {t.pts} pts
                    </span>
                  </Link>
                </th>
              ))}
              <th className="tg aggh">Avg</th>
              <th className="tg aggh l">Best into</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.flatMap(({ unit: u, cells, avg, best }) => {
              const sec = sectionOf(u, groups)
              const out = []
              if (sec !== last) {
                out.push(
                  <tr className="sec" key={`sec-${sec}`}>
                    <td colSpan={m.targets.length + 3}>{sec}</td>
                  </tr>
                )
                last = sec
              }
              out.push(
                <tr key={u.id}>
                  <td className="rowh">
                    <Link to={`units/${u.id}`} prefetch="intent">
                      <span className="un">
                        {u.nm}
                        {rowModified(u, opts, modIsSet) ? <span className="modtag">modified</span> : null}
                      </span>
                      <span className="um">{unitSub(u, opts)}</span>
                    </Link>
                  </td>
                  {cells.map((c, k) => {
                    const h = heat(c.roi)
                    const t = m.targets[k]
                    return (
                      <td key={t.id} className={`c ${h.efficient ? "eff" : ""} ${colClass(k)}`}>
                        <Link
                          to={`units/${u.id}?vs=${t.id}`}
                          style={{ background: h.bg, color: h.fg }}
                          title={`${u.nm} into ${t.nm}: ${f1(c.roi)}%`}
                        >
                          {Math.round(c.roi)}
                        </Link>
                      </td>
                    )
                  })}
                  <td className="agg">{Math.round(avg)}</td>
                  <td className="agg best" title={m.targets[best].nm}>
                    {m.targets[best].nm}
                  </td>
                </tr>
              )
              return out
            })}
            <tr className="cov">
              <td className="rowh">Units at {EFFICIENT}% or better</td>
              {m.coverage.map((n, k) => (
                <td key={m.targets[k].id} className={`${n === 0 ? "zero" : ""} ${colClass(k)}`}>
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
        {notes.map((f, i) => (
          <FindingItem key={i} f={f} targets={m.targets} />
        ))}
      </ul>
    </>
  )
}

function FindingItem({ f }: { f: Finding; targets: ReadonlyArray<Target> }) {
  switch (f.kind) {
    case "covered":
      return <li>Every benchmark target has at least one answer at {EFFICIENT}% or better.</li>
    case "gap":
      return (
        <li className="alert">
          Nothing here removes <Link to={`targets/${f.target.id}`}>{f.target.nm}</Link> efficiently. Your best answer is{" "}
          <Link to={`units/${f.unit.id}?vs=${f.target.id}`}>{f.unit.nm}</Link> at <b>{f1(f.roi)}%</b>
          {f.others > 0 ? `, and ${f.others} other target${f.others > 1 ? "s sit" : " sits"} under the ${EFFICIENT}% line too` : ""}.
        </li>
      )
    case "prime":
      return (
        <li className="gold">
          <Link to={`units/${f.unit.id}`}>{f.unit.nm}</Link> is your prime trigger: {EFFICIENT}% or better into{" "}
          <b>
            {f.count} of {f.of}
          </b>{" "}
          targets, peaking at {f1(f.peak)}% into {f.peakTarget.nm}.
        </li>
      )
    case "enhancement":
      return f.adds ? (
        <li>
          <Link to={`units/${f.unit.id}`}>{f.unit.nm}</Link> pays {f.pts} pts for {f.enhancement}, the biggest enhancement cost in the list.
          With it the unit averages <b>{f1(f.withIt)}%</b>; without it at all, {f1(f.without)}%.{" "}
          {Math.abs(f.withIt - f.without) < 2
            ? "It roughly breaks even on damage alone."
            : f.withIt > f.without
              ? "Its damage more than covers its cost."
              : "Its damage doesn’t cover its cost against these targets."}
        </li>
      ) : (
        <li>
          <Link to={`units/${f.unit.id}`}>{f.unit.nm}</Link> pays {f.pts} pts for {f.enhancement}, which adds no damage against these targets,
          so its average return drops from {f1(f.free)}% to <b>{f1(f.withIt)}%</b>. That’s the biggest enhancement cost in the list.
        </li>
      )
  }
}
