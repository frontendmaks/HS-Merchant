/**
 * Taking a product out of sale — asked for by one person, decided by another.
 *
 * Approval does not delete the offer from the feeds. A missing offer reads to
 * a marketplace as "this product no longer exists", and it retires the card
 * along with its reviews, its rating and its place in search. What approval
 * does is stop the product being sellable: the offer stays and goes out as
 * out of stock, zero, permanently, until someone puts it back.
 */

export type RemovalStatus = 'pending' | 'approved' | 'rejected' | 'canceled'

export const REMOVAL_STATUS_META: Record<RemovalStatus, { label: string; badge: string }> = {
  pending:  { label: 'На розгляді', badge: 'bg-amber-950/60 text-amber-400' },
  approved: { label: 'Підтверджено', badge: 'bg-emerald-950/60 text-emerald-400' },
  rejected: { label: 'Відхилено',    badge: 'bg-red-950/60 text-red-400' },
  canceled: { label: 'Скасовано',    badge: 'bg-zinc-800 text-zinc-500' },
}

/** Only these decide. Everyone else may ask. */
export const CAN_DECIDE_REMOVAL = ['super_admin', 'admin'] as const

export const canDecideRemoval = (role: string | null | undefined) =>
  !!role && (CAN_DECIDE_REMOVAL as readonly string[]).includes(role)

/** A reason short enough to be a shrug explains nothing to whoever decides. */
export const MIN_REMOVAL_REASON = 10

export const isOpen = (status: string) => status === 'pending'
