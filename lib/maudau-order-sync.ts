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
 * Our integration token cannot reach that path. It is issued for
 * /v1/merchant_public_api/ and /v1/merchant/ answers `401 wrong scope`.
 * Sending the same payload to the public API is silently ignored: a probe with
 * an invented field name returned an identical 200, and a real 10 → 11 change
 * left the order untouched.
 *
 * So this stays switched off until MAUDAU_CABINET_TOKEN exists. Nothing here
 * can fire without it.
 */

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

  const res = await fetch(`${CABINET_BASE}/v1/merchant/orders/${marketplaceOrderId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items_attributes: lines.map(l => ({
        id: Number(l.itemId),
        quantity: l.quantity,
      })),
    }),
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
    }
  } catch {
    return { ok: true }
  }
}
