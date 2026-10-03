/** A benchmark target: its defensive profile (editable) and every attacker ranked against it. */
import { Effect, Schema } from "effect"
import { useMemo } from "react"
import { data, Form, Link, redirect, useFetcher } from "react-router"
import { requireOwner } from "~/.server/access"
import { Targets } from "~/.server/repos/Targets"
import { run } from "~/.server/runtime"
import { f1, plural, useLedger } from "~/components/ledger"
import { attack, barBackground, heat, phaseLabel, rows } from "~/domain/ledger"
import { Target } from "~/domain/schema"
import { isOwner, useViewer } from "~/viewer"
import type { Route } from "./+types/list.target"

const FIELDS = ["pts", "T", "Sv", "inv", "W", "N", "fnp", "dr"] as const

/** Targets made from a datasheet (see the database pages) carry this prefix. */
const isAdded = (id: string) => id.startsWith("ds-")

/** Targets are shared by every list, so this saves to the benchmark set itself, and only the site's owner can. */
export async function action({ request, params, context }: Route.ActionArgs) {
  requireOwner(context, request)
  const form = await request.formData()
  if (form.get("intent") === "remove") {
    // only targets added from the database can be removed; the calibrated set is restored, not deleted
    if (isAdded(params.targetId)) await run(Effect.flatMap(Targets, (t) => t.remove(params.targetId)))
    return redirect(`/lists/${params.listId}`)
  }
  await run(Effect.gen(function*() {
    const targets = yield* Targets
    const current = (yield* targets.all).find((t) => t.id === params.targetId)
    if (!current) return yield* Effect.fail({ _tag: "TargetNotFound" as const, message: "Unknown target." })
    const next: Record<string, unknown> = { ...current }
    for (const f of FIELDS) {
      const n = parseFloat(String(form.get(f) ?? ""))
      if (!Number.isNaN(n) && n >= 0) next[f] = f === "N" || f === "W" || f === "pts" ? Math.max(1, n) : n
    }
    const kw = form.get("kw")
    if (typeof kw === "string") next.kw = kw.trim().toUpperCase()
    const target = yield* Schema.decodeUnknownEffect(Target)(next).pipe(
      Effect.mapError(() => ({ _tag: "InvalidInput" as const, message: "Those values don’t make a valid target." }))
    )
    yield* targets.save(target)
  }))
  return { ok: true }
}

export default function TargetView({ params }: Route.ComponentProps) {
  const ledger = useLedger()
  const fetcher = useFetcher()
  const owner = isOwner(useViewer())
  const saved = ledger.targets.find((x) => x.id === params.targetId)
  if (!saved) throw data({ message: "Unknown target." }, { status: 404 })

  // recalculate from what's in the form while the save is in flight
  const t = useMemo<Target>(() => {
    const fd = fetcher.formData
    if (!fd) return saved
    const next: Record<string, unknown> = { ...saved }
    for (const f of FIELDS) {
      const n = parseFloat(String(fd.get(f) ?? ""))
      if (!Number.isNaN(n) && n >= 0) next[f] = f === "N" || f === "W" || f === "pts" ? Math.max(1, n) : n
    }
    if (typeof fd.get("kw") === "string") next.kw = String(fd.get("kw")).trim().toUpperCase()
    return next as unknown as Target
  }, [fetcher.formData, saved])

  const ranked = useMemo(
    () => rows(ledger).map((u) => ({ u, r: attack(ledger, u, t) })).sort((a, b) => b.r.roi - a.r.roi),
    [ledger, t]
  )
  const ppw = t.pts / (t.W * t.N)
  const field = (f: (typeof FIELDS)[number] | "kw", label: string, wide = false) => (
    <label>
      {label}
      <input name={f} className={wide ? "wide" : ""} defaultValue={String(saved[f])} key={`${saved.id}-${f}-${saved[f]}`} />
    </label>
  )

  return (
    <>
      <div className="crumbs">
        <Link to="..">Damage matrix</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>{t.nm}</h2>
          <div className="meta">
            {t.N} {plural(t.N, "model")} with {t.W} {plural(t.W, "wound")} each, {t.pts} pts, so every wound is worth {f1(ppw)} pts.
          </div>
        </div>
        <div className="ptsbig">
          {f1(ppw)}
          <small>points per wound</small>
        </div>
      </div>
      <fetcher.Form method="post" className="tprof" onBlur={(e) => owner && fetcher.submit(e.currentTarget)}>
        <fieldset disabled={!owner} className="plain">
        {field("pts", "Points")}
        {field("T", "Toughness")}
        {field("Sv", "Save")}
        {field("inv", "Invuln (0 = none)")}
        {field("W", "Wounds each")}
        {field("N", "Models")}
        {field("fnp", "Feel No Pain (0 = none)")}
        {field("dr", "Damage reduction")}
        {field("kw", "Keywords", true)}
        {owner ? (
          <button className="btn" type="submit">
            Save
          </button>
        ) : null}
        </fieldset>
      </fetcher.Form>
      <p className="hint">
        {owner
          ? "The benchmark set is shared by every list. “Restore this list and the default targets” below puts it back."
          : "The benchmark set is shared by every list; only the site’s owner can change it."}
      </p>
      {owner && isAdded(saved.id) ? (
        <Form method="post">
          <button className="btn ghost danger" type="submit" name="intent" value="remove" style={{ marginLeft: 0 }}>
            Remove this target from the benchmark set
          </button>
        </Form>
      ) : null}
      <section style={{ paddingTop: 16 }}>
        <h3 className="sh">
          Who removes it best <span>{phaseLabel(ledger.opts.phase)}</span>
        </h3>
        <ul className="bars">
          {ranked.map(({ u, r }) => {
            const h = heat(r.roi)
            const to = `../units/${u.id}?vs=${t.id}`
            return (
              <li key={u.id}>
                <Link className="bn" to={to}>
                  {u.nm}
                  {u.sub ? ` (${u.sub})` : ""}
                </Link>
                <Link className="track" to={to} aria-label={`${f1(r.roi)}%`}>
                  <span className="fill" style={{ width: `${Math.min(r.roi, 200) / 2}%`, background: barBackground(h) }} />
                  <span className="mk" style={{ left: "32.5%" }} />
                  <span className="mk m100" style={{ left: "50%" }} />
                </Link>
                <span className="bv">{Math.round(r.roi)}%</span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
