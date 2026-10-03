import { useOutletContext } from "react-router"
import type { Ledger } from "~/domain/ledger"
import type { ArmyList } from "~/domain/schema"

/** What the list layout hands its child routes. */
export interface LedgerContext extends Ledger {
  readonly list: ArmyList
  /** Where option changes are posted: the list layout's own action. */
  readonly action: string
  /** Whether this viewer can change the list itself (its units, points, rules); anyone can change its switches for themselves. */
  readonly canEdit: boolean
}

export const useLedger = () => useOutletContext<LedgerContext>()

export const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
export const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many)
