/** Rules matrix: every rule in the list as a chip, by unit and by where it comes from. */
import { Link } from "react-router"
import { Chip, DemoChip } from "~/components/chips"
import { useLedger } from "~/components/ledger"
import { shortName } from "~/domain/engine"
import { unitSub } from "~/domain/ledger"

const none = <span className="none">none</span>

export default function RulesView() {
  const { list, units, rules, opts, groups } = useLedger()
  const army = list.armyRules.filter((id) => rules[id])
  const inList = [...new Set([...units.flatMap((u) => u.rules), ...list.armyRules])].map((id) => rules[id]).filter(Boolean)
  const counted = inList.filter((r) => r.dmg).length
  const todo = inList.filter((r) => r.todo).length

  let last: string | null = null
  return (
    <>
      <div className="legend">
        <div className="eq">Every rule in the list, and whether it moves the numbers</div>
        <div className="keyrow">
          <span>
            <DemoChip state="on">Counted</DemoChip> changes damage and is in the maths
          </span>
          <span>
            <DemoChip state="idle">Idle</DemoChip> changes damage, but its condition is off
          </span>
          <span>
            <DemoChip state="off">Off</DemoChip> changes damage, switched off
          </span>
          <span>
            <DemoChip state="mark-off">Mark</DemoChip> marks a target; switch it on to apply
          </span>
          <span>
            <DemoChip state="note">Noted</DemoChip> real rule, no effect on damage dealt
          </span>
          <span>
            <DemoChip state="todo">Not modelled</DemoChip> looks like it changes damage, not in the maths yet
          </span>
        </div>
        <p className="lede">
          {inList.length} rules across the army, {counted} of which change how much damage your units deal
          {todo ? `, and ${todo} that probably do but aren’t modelled yet` : ""}. Tap any rule to read it and switch it. Stratagems are left
          out.
        </p>
      </div>
      <div className="armyrules">
        <h3>Army and detachments</h3>
        <div className="armygrid">
          {army.length ? (
            army.map((id) => (
              <div className="armyrule" key={id}>
                <Chip owner="army" id={id} />
                <span>{rules[id].reach ?? ""}</span>
              </div>
            ))
          ) : (
            <span className="none">None in the library for this list yet.</span>
          )}
        </div>
      </div>
      <div className="mx-scroll">
        <table className="rx">
          <thead>
            <tr>
              <th className="rowh">Unit</th>
              <th>Enhancement</th>
              <th>Abilities</th>
              <th>Wargear</th>
              <th>Shared from its attached unit</th>
              <th>Marks a target</th>
            </tr>
          </thead>
          <tbody>
            {units.flatMap((u) => {
              const group = u.grp ? groups[u.grp] : undefined
              const sec = group ? `${group.nm}: ${group.short}` : u.cat || "Other"
              const own = u.rules.filter((id) => rules[id])
              const abilities = own.filter(
                (id) => !["Wargear", "Enhancement", "Received"].includes(rules[id].src) && !rules[id].mark && !list.armyRules.includes(id)
              )
              const gear = own.filter((id) => rules[id].src === "Wargear")
              const marks = own.filter((id) => rules[id].mark)
              const shared = u.grp
                ? units
                    .filter((m) => m.grp === u.grp && m.id !== u.id)
                    .flatMap((m) => m.rules.filter((id) => rules[id]?.scope === "unit").map((id) => ({ m, id })))
                : []
              const out = []
              if (sec !== last) {
                out.push(
                  <tr className="sec" key={`sec-${sec}`}>
                    <td colSpan={6}>{sec}</td>
                  </tr>
                )
                last = sec
              }
              out.push(
                <tr key={u.id}>
                  <td className="rowh">
                    <Link to={`../units/${u.id}`}>
                      <span className="un">{u.nm}</span>
                      <span className="um">
                        {unitSub(u, opts)}
                        {u.role ? `, ${u.role.toLowerCase()}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td>{u.enh?.id ? <Chip owner={u.id} id={u.enh.id} label={`${u.enh.nm} (+${u.enh.pts})`} /> : none}</td>
                  <td>{abilities.length ? abilities.map((id) => <Chip key={id} owner={u.id} id={id} />) : none}</td>
                  <td>{gear.length ? gear.map((id) => <Chip key={id} owner={u.id} id={id} />) : none}</td>
                  <td>
                    {shared.length ? (
                      shared.map(({ m, id }) => <Chip key={`${m.id}:${id}`} owner={m.id} id={id} label={`${rules[id].nm} ← ${shortName(m.nm)}`} />)
                    ) : (
                      <span className="none">{u.grp ? "nothing shared" : "not attached"}</span>
                    )}
                  </td>
                  <td>{marks.length ? marks.map((id) => <Chip key={id} owner={u.id} id={id} />) : none}</td>
                </tr>
              )
              return out
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
