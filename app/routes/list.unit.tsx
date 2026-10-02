/**
 * Unit dossier: matchups sorted by return, the per-weapon attack table, the Σ
 * panel with the real numbers in the formula, the rules in play, and the
 * loadout (editable for single datasheets).
 */
import { Effect, Schema } from "effect"
import { useMemo } from "react"
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import { Chip } from "~/components/chips"
import { f1, f2, type LedgerContext, plural, useLedger } from "~/components/ledger"
import { type AttackResult, shortName, unitPts } from "~/domain/engine"
import { keywordsFromInput, keywordsToInput, keywordText } from "~/domain/keywords"
import { attack, barBackground, findUnit, heat, phaseLabel, rulesInPlay } from "~/domain/ledger"
import { type Target, Unit, type Weapon } from "~/domain/schema"
import type { Route } from "./+types/list.unit"

const diceInput = (v: string) => (/d/i.test(v) ? v.toUpperCase().replace(/\s+/g, "") : parseFloat(v) || 0)

/** Save an edited loadout. Only single datasheets are editable; an attached unit is edited through its members. */
export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  const text = (k: string) => String(form.get(k) ?? "").trim()
  await run(Effect.gen(function*() {
    const lists = yield* Lists
    const list = yield* lists.get(params.listId)
    const unit = list.units.find((u) => u.id === params.unitId)
    if (!unit) return yield* Effect.fail({ _tag: "UnitNotFound" as const, message: "That unit isn’t in this list." })
    // the form edits the unit's own cost; what is stored includes the enhancement
    const own = parseFloat(text("pts"))
    const pts = own > 0 ? own + (unit.enh?.pts ?? 0) : NaN
    const w = unit.w.map((old, i): Weapon => {
      const kwIn = text(`w${i}.kw`)
      return {
        ...old,
        nm: text(`w${i}.nm`) || old.nm,
        n: parseFloat(text(`w${i}.n`)) || 0,
        A: diceInput(text(`w${i}.A`)),
        sk: parseFloat(text(`w${i}.sk`)) || 0,
        S: parseFloat(text(`w${i}.S`)) || 0,
        AP: Math.abs(parseFloat(text(`w${i}.AP`)) || 0),
        D: diceInput(text(`w${i}.D`)),
        // the compact form can't express everything (conditions, unknown abilities); only replace what was retyped
        kw: kwIn === keywordsToInput(old.kw) ? old.kw : keywordsFromInput(kwIn)
      }
    })
    const next = yield* Schema.decodeUnknownEffect(Unit)({ ...unit, pts: pts > 0 ? pts : unit.pts, w }).pipe(
      Effect.mapError(() => ({ _tag: "InvalidInput" as const, message: "Those profile values don’t make a valid unit." }))
    )
    yield* lists.saveUnit(params.listId, next)
  }))
  const url = new URL(request.url)
  url.searchParams.delete("edit")
  return redirect(url.pathname + url.search)
}

export const meta: Route.MetaFunction = ({ matches, params }) => {
  const list = (matches.find((m) => m?.id === "routes/list")?.data as { list?: { units: Array<Unit>; meta: { name: string } } } | undefined)?.list
  const unit = list ? findUnit({ units: list.units }, params.unitId) : undefined
  return [{ title: `${unit?.nm ?? "Unit"} · ${list?.meta.name ?? "Cogitator Core"}` }]
}

export default function UnitView({ params }: Route.ComponentProps) {
  const ledger = useLedger()
  const { opts, groups, targets } = ledger
  const [search] = useSearchParams()
  const u = findUnit(ledger, params.unitId)

  const results = useMemo(() => (u ? targets.map((t) => ({ t, r: attack(ledger, u, t) })) : []), [ledger, u, targets])
  if (!u) {
    throw data({ message: "That unit isn’t in this list." }, { status: 404 })
  }
  if (!results.length) return <p className="empty">There are no benchmark targets to score against.</p>

  const sel = results.find((x) => x.t.id === search.get("vs")) ?? results.reduce((a, b) => (b.r.roi > a.r.roi ? b : a))
  const vs = sel.t.id
  const editing = search.get("edit") === "1" && !u.combined
  const group = u.grp ? groups[u.grp] : undefined
  const models = `${u.models} ${plural(u.models, "model")}`
  const groupLine = u.combined
    ? `${group?.nm ?? "Attached unit"}, ${models}`
    : u.grp
      ? `${group?.nm ?? "Attached unit"} ${(u.role ?? "member").toLowerCase()}, ${models}`
      : `${u.cat ?? "Other"}, ${models}`
  const base = unitPts(u, { enh: false })
  const ptsLine = u.enh ? (opts.enh ? `${base} + ${u.enh.pts} for ${u.enh.nm}` : `${u.enh.nm} (${u.enh.pts}) excluded`) : "datasheet cost"
  const avg = results.reduce((s, x) => s + x.r.roi, 0) / results.length
  const link = (targetId: string) => `?vs=${targetId}`

  const bars = (infantry: boolean) =>
    results
      .filter((x) => (x.t.cls === "inf") === infantry)
      .sort((a, b) => b.r.roi - a.r.roi)
      .map(({ t, r }) => {
        const h = heat(r.roi)
        return (
          <li key={t.id} className={t.id === vs ? "sel" : ""}>
            <Link className="bn" to={link(t.id)} preventScrollReset replace>
              {t.nm}
            </Link>
            <Link className="track" to={link(t.id)} preventScrollReset replace aria-label={`${t.nm} ${f1(r.roi)}%`}>
              <span className="fill" style={{ width: `${Math.min(r.roi, 200) / 2}%`, background: barBackground(h) }} />
              <span className="mk" style={{ left: "32.5%" }} />
              <span className="mk m100" style={{ left: "50%" }} />
            </Link>
            <span className="bv">{Math.round(r.roi)}%</span>
          </li>
        )
      })

  return (
    <>
      <div className="crumbs">
        <Link to="..">Damage matrix</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>{u.nm}</h2>
          <div className="meta">
            {groupLine}
            {u.sub ? `, ${u.sub}` : ""}. Averages {f1(avg)}% across {targets.length} targets. {phaseLabel(opts.phase)}.
          </div>
          {u.combined ? (
            <p className="hint">
              Split view:{" "}
              {(u.members ?? []).map((mid, i) => (
                <span key={mid}>
                  {i ? ", " : ""}
                  <Link to={`../units/${mid}?vs=${vs}`}>{ledger.units.find((x) => x.id === mid)?.nm ?? mid}</Link>
                </span>
              ))}
              .
            </p>
          ) : u.grp && group ? (
            <p className="hint">
              Part of <Link to={`../units/grp-${u.grp}?vs=${vs}`}>{group.short}</Link>; the rules they share still apply in this split view.
            </p>
          ) : null}
        </div>
        <div className="ptsbig">
          {unitPts(u, opts)} pts<small>{ptsLine}</small>
        </div>
      </div>
      <div className="dgrid">
        <section>
          <h3 className="sh">
            Matchups <span>sorted by return; marks at 65% and 100%</span>
          </h3>
          <ul className="bars">
            <li className="cls">Infantry and beasts</li>
            {bars(true)}
            <li className="cls">Vehicles and monsters</li>
            {bars(false)}
          </ul>
        </section>
        <section>
          <h3 className="sh">
            Attack detail <span>into {sel.t.nm}</span>
          </h3>
          <DetailTable r={sel.r} phase={opts.phase} />
          <Sigma key={vs} ledger={ledger} u={u} t={sel.t} r={sel.r} />
          <RulesInPlay ledger={ledger} u={u} />
          <h3 className="sh">
            Loadout <span>{u.combined ? "edit the members to change these" : "what the matrix is built from"}</span>
          </h3>
          <Loadout u={u} editing={editing} />
        </section>
      </div>
    </>
  )
}

function DetailTable({ r, phase }: { r: AttackResult; phase: string }) {
  return (
    <div className="tbl-scroll">
      <table className="dt">
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Type</th>
            <th>Models</th>
            <th>Attacks</th>
            <th title="Chance to hit. The small line is extra hits per attack from Sustained Hits">Hit</th>
            <th title="Wounds per hit. Lethal Hits count as automatic wounds">Wound</th>
            <th title="Share of wounds that get past saves">Fail save</th>
            <th>Dmg/wound</th>
            <th>Wounds dealt</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="emptyrow">
                No {phase === "ranged" ? "ranged" : "melee"} weapons on this unit.
              </td>
            </tr>
          ) : null}
          {r.rows.map((x, i) =>
            x.skipped ? (
              <tr className="skip" key={i}>
                <td>
                  <span className="wn">{x.w.nm}</span>
                  <span className="wnotes">{x.skipped}</span>
                </td>
                <td>{x.w.t === "r" ? "ranged" : "melee"}</td>
                <td>{x.w.n}</td>
                <td colSpan={6}>not used</td>
              </tr>
            ) : (
              <tr key={i}>
                <td>
                  <span className="wn">{x.w.nm}</span>
                  {x.notes?.length ? <span className="wnotes">{x.notes.join(", ")}</span> : null}
                </td>
                <td>{x.w.t === "r" ? "ranged" : "melee"}</td>
                <td>{x.models}</td>
                <td>{f1(x.attacks ?? 0)}</td>
                <td>
                  {f1((x.hitChance ?? 0) * 100)}%
                  {(x.susExtra ?? 0) > 0.0005 ? <span className="sub">+{f1((x.susExtra ?? 0) * 100)} sustained</span> : null}
                </td>
                <td>
                  {f1((x.wound ?? 0) * 100)}%{(x.lethalShare ?? 0) > 0.0005 ? <span className="sub">incl. lethal</span> : null}
                </td>
                <td>{f1((x.fail ?? 0) * 100)}%</td>
                <td>{f2(x.dmg ?? 0)}</td>
                <td className="dealt">{f2(x.dealt ?? 0)}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  )
}

/** The formula with the real numbers in it. */
function Sigma({ ledger, u, t, r }: { ledger: LedgerContext; u: Unit; t: Target; r: AttackResult }) {
  const { opts } = ledger
  const cls = r.roi >= 100 ? "hi" : r.roi < 35 ? "lo" : ""
  const share = (r.total / r.pool) * 100
  const without = u.enh && opts.enh ? attack(ledger, u, t, { ...opts, enh: false }) : null
  const poolLine = r.capped
    ? `That wipes all ${r.pool} wounds; the extra is ignored because overkill is capped.`
    : share >= 100
      ? `That’s more than the unit’s ${r.pool} wounds, so ${f1(r.total - r.pool)} of it is overkill unless you switch on the cap.`
      : `That’s ${Math.round(share)}% of the unit’s ${r.pool} wounds.`
  return (
    <div className="sigma flash" id="sigma">
      <div className="line">
        <span className="term">
          Σ {f2(r.total)}
          <small>wounds dealt</small>
        </span>
        <span className="op">(</span>
        <span className="term">
          {f2(r.total)}
          <small>wounds</small>
        </span>
        <span className="op">÷</span>
        <span className="term">
          {r.pts}
          <small>your points</small>
        </span>
        <span className="op">)</span>
        <span className="op">×</span>
        <span className="term">
          {f1(r.ppw)}
          <small>their pts per wound</small>
        </span>
        <span className="op">×</span>
        <span className="term">100</span>
        <span className="op">=</span>
        <span className={`term res ${cls}`}>
          {f1(r.roi)}%<small>return</small>
        </span>
      </div>
      <p>
        {u.nm} {u.combined ? "remove" : "removes"} about <b>{Math.round(r.total * r.ppw)} pts</b> of {t.nm} for the {r.pts} pts{" "}
        {u.combined ? "they cost" : "spent"}. {poolLine}
      </p>
      {without && u.enh ? (
        <p className="alt">
          Without {u.enh.nm} ({without.pts} pts) the same attacks return {f1(without.roi)}%.
        </p>
      ) : null}
    </div>
  )
}

function RulesInPlay({ ledger, u }: { ledger: LedgerContext; u: Unit }) {
  const { rules: er, noted } = rulesInPlay(ledger, u)
  return (
    <>
      <h3 className="sh">
        Rules in play <span>{er.length ? "tap one to read or switch it" : "none of this unit’s rules change damage"}</span>
      </h3>
      {er.length ? (
        <div className="chips">
          {er.map((x) => {
            const owner = ledger.units.find((m) => m.id === x.owner)
            const label = x.owner === u.id || u.combined ? x.r.nm : `${x.r.nm} ← ${shortName(owner?.nm ?? x.owner)}`
            return <Chip key={`${x.owner}:${x.id}`} owner={x.owner} id={x.id} label={label} />
          })}
        </div>
      ) : null}
      {noted ? (
        <p className="hint">
          {noted} more {plural(noted, "rule")} on {u.combined ? "these datasheets" : "this datasheet"} don’t change damage.{" "}
          <Link to="../rules">See them in the rules matrix</Link>.
        </p>
      ) : null}
    </>
  )
}

function Loadout({ u, editing }: { u: Unit; editing: boolean }) {
  const [search] = useSearchParams()
  const navigation = useNavigation()
  const saving = navigation.state === "submitting"
  const toggle = new URLSearchParams(search)
  if (editing) toggle.delete("edit")
  else toggle.set("edit", "1")

  const head = (
    <thead>
      <tr>
        <th>Weapon</th>
        <th>Type</th>
        <th>Models</th>
        <th>A</th>
        <th>BS/WS</th>
        <th>S</th>
        <th>AP</th>
        <th>D</th>
        <th className="l">Abilities</th>
      </tr>
    </thead>
  )

  if (!editing) {
    return (
      <>
        {u.combined ? null : (
          <div className="editbar">
            <Link className="btn" to={`?${toggle}`} preventScrollReset replace>
              Edit profiles
            </Link>
          </div>
        )}
        <div className="tbl-scroll">
          <table className="dt">
            {head}
            <tbody>
              {u.w.map((w, i) => (
                <tr key={i} className={w.off ? "skip" : ""}>
                  <td>
                    <span className="wn">{w.nm}</span>
                    {w.off ? <span className="wnotes">{w.off}</span> : null}
                  </td>
                  <td>{w.t === "r" ? "ranged" : "melee"}</td>
                  <td>{w.n}</td>
                  <td>{w.A}</td>
                  <td>{w.kw?.torrent ? "N/A" : `${w.sk}+`}</td>
                  <td>{w.S}</td>
                  <td>{w.AP ? `-${w.AP}` : "0"}</td>
                  <td>{w.D}</td>
                  <td className="l">{keywordText(w)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <Form method="post" preventScrollReset>
      <div className="editbar">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save profiles"}
        </button>
        <Link className="btn" to={`?${toggle}`} preventScrollReset replace>
          Cancel
        </Link>
        <label>
          {u.enh ? "Unit points" : "Points"}{" "}
          <input className="ptsin" name="pts" defaultValue={u.pts - (u.enh?.pts ?? 0)} inputMode="numeric" />
          {u.enh ? <span className="hint">+ {u.enh.pts} for {u.enh.nm}</span> : null}
        </label>
      </div>
      <div className="tbl-scroll">
        <table className="dt">
          {head}
          <tbody>
            {u.w.map((w, i) => (
              <tr key={i}>
                <td>
                  <input className="nmin" name={`w${i}.nm`} defaultValue={w.nm} aria-label="Weapon name" />
                </td>
                <td>{w.t === "r" ? "ranged" : "melee"}</td>
                <td>
                  <input name={`w${i}.n`} defaultValue={w.n} aria-label="Models" />
                </td>
                <td>
                  <input name={`w${i}.A`} defaultValue={w.A} aria-label="Attacks" />
                </td>
                <td>
                  <input name={`w${i}.sk`} defaultValue={w.sk} aria-label="Skill" />
                </td>
                <td>
                  <input name={`w${i}.S`} defaultValue={w.S} aria-label="Strength" />
                </td>
                <td>
                  <input name={`w${i}.AP`} defaultValue={w.AP} aria-label="AP" />
                </td>
                <td>
                  <input name={`w${i}.D`} defaultValue={w.D} aria-label="Damage" />
                </td>
                <td className="l">
                  <input className="kwin" name={`w${i}.kw`} defaultValue={keywordsToInput(w.kw)} aria-label="Abilities" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Abilities are typed as words: torrent lethal sus1 tl dev lance blast melta2 heavy rf1 cleave1 anti-infantry2 pistol ic. Leave a
        weapon’s abilities untouched to keep conditions the short form can’t express. “Restore this list” at the foot of the page undoes
        every edit.
      </p>
    </Form>
  )
}
