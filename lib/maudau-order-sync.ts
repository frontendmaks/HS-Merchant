/**
 * Pushing corrected line quantities back to MauDau.
 *
 * The cabinet does this with:
 *
 *   PATCH https://backend.prod.maudau.click/v1/merchant/orders/{orderId}
 *   { "items_attributes": [ { "id": 56211854, "quantity": 11 } ] }
 *
 * and MauDau recalculates total_price and merchant_commission_amount itself —
 * verified against a real order: 10 → 11 moved the total from 1180 to 1298 and
 * the commission from 165.20 to 181.72 at 14%.
 *
 * Two scopes exist. Our integration token is `v1_merchant_api_user` and gets
 * `401 wrong scope` on /v1/merchant/; the cabinet runs as
 * `v1_merchant_employee`. Sending items_attributes to merchant_public_api is
 * silently ignored — an invented field name returns the same 200, and a real
 * 10 → 11 change left the order untouched.
 *
 * Verified end to end with an employee token: 10 → 11 moved the order to
 * 1298.00 and the commission to 181.72, and reverting restored both exactly.
 *
 * IMPORTANT: quantity is whole units only. A request for 10.4 came back 200
 * with the quantity still 10, so a weighed line cannot carry its invoice
 * weight — see WHOLE_UNITS_ONLY below.
 */

/** MauDau silently drops fractional quantities, so a weighed correction can
 *  only be expressed in whole packs. Verified against a live order. */
export const WHOLE_UNITS_ONLY = true

/** How many listed packs a corrected line amounts to.
 *  Weighed goods: actual kg ÷ pack size. Piece goods: the count itself,
 *  since their pack size is 1. */
export const packsFor = (amount: number, unitWeight: number): number =>
  unitWeight > 0 ? amount / unitWeight : amount

/** Whole within a hair — floating point makes 1.3 / 0.65 land on 1.9999…  */
export const isWhole = (n: number, eps = 1e-6): boolean =>
  Math.abs(n - Math.round(n)) < eps

const CABINET_BASE = process.env.MAUDAU_CABINET_BASE ?? 'https://backend.prod.maudau.click'

export const canPushToMaudau = () => !!process.env.MAUDAU_CABINET_TOKEN

export interface LineQuantity {
  /** MauDau's own item id, stored as order_items.marketplace_item_id */
  itemId: string
  quantity: number
}

export interface PushResult {
  ok: boolean
  /** Totals MauDau reports after applying the change, in UAH */
  total?: number
  commission?: number
  error?: string
  /** Lines MauDau cannot represent, because the pack count is fractional */
  skipped?: { itemId: string; wanted: number }[]
}

export async function pushOrderItems(
  marketplaceOrderId: string,
  lines: LineQuantity[],
): Promise<PushResult> {
  const token = process.env.MAUDAU_CABINET_TOKEN
  if (!token) {
    return { ok: false, error: 'MAUDAU_CABINET_TOKEN не налаштовано — відправка вимкнена' }
  }
  if (!lines.length) return { ok: false, error: 'Немає позицій для відправки' }

  // A fractional quantity comes back 200 with nothing changed, so anything not
  // whole is left out and reported rather than silently discarded.
  const skipped: NonNullable<PushResult['skipped']> = []
  const payload: { id: number; quantity: number }[] = []
  for (const l of lines) {
    if (!isWhole(l.quantity)) {
      skipped.push({ itemId: l.itemId, wanted: l.quantity })
      continue
    }
    payload.push({ id: Number(l.itemId), quantity: Math.round(l.quantity) })
  }

  if (!payload.length) {
    return {
      ok: false,
      skipped,
      error: 'Жодну позицію не можна передати: MauDau приймає лише цілу кількість пачок',
    }
  }

  const res = await fetch(`${CABINET_BASE}/v1/merchant/orders/${marketplaceOrderId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items_attributes: payload }),
  })

  const text = await res.text()
  if (!res.ok) {
    return { ok: false, error: `MauDau ${res.status}: ${text.slice(0, 200)}` }
  }

  try {
    const body = JSON.parse(text)
    return {
      ok: true,
      total: (body.total_price ?? 0) / 100,
      commission: (body.merchant_commission_amount ?? 0) / 100,
      skipped: skipped.length ? skipped : undefined,
    }
  } catch {
    return { ok: true, skipped: skipped.length ? skipped : undefined }
  }
}
