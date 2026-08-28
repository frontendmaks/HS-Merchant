/**
 * Handing a waybill number to the marketplace.
 *
 * Both places that produce a TTN need this: typing one in by hand, and creating
 * one at Nova Poshta from the order. Neither marketplace takes a bare tracking
 * number — each wants the order walked through its own chain of statuses first,
 * and setting the number is the step that also marks the order as shipped.
 */

import { getMaudauJwt, patchMaudauStatus, patchMaudauTtn } from '@/lib/maudau'
import { rozetkaToken } from '@/lib/rozetka-auth'

/** What the order becomes once the marketplace has the number. */
export const SHIPPED_STATUS: Record<string, string> = {
  maudau: 'На доставці',
  rozetka: 'Передано в доставку',
}

interface RozetkaStatusEntry {
  child_id: number
  title: string
}

async function rozetkaOrder(numericId: string): Promise<RozetkaStatusEntry[]> {
  const res = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
    headers: { Authorization: `Bearer ${await rozetkaToken()}` },
  })
  const detail = await res.json() as {
    data?: { status_available?: RozetkaStatusEntry[] }
    content?: { status_available?: RozetkaStatusEntry[] }
  }
  return detail?.data?.status_available ?? detail?.content?.status_available ?? []
}

async function putRozetka(numericId: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await rozetkaToken()}`,
    },
    body: JSON.stringify(body),
  })
}

/** Advance only if the step is still offered — an order already past it is not
 *  an error, and Rozetka lists exactly which moves it will accept. */
async function advanceRozetka(numericId: string, targetId: number): Promise<void> {
  const available = await rozetkaOrder(numericId)
  if (!available.some(s => s.child_id === targetId)) return
  await putRozetka(numericId, { status: targetId })
}

export interface PushTtnResult {
  ok: boolean
  /** The status the order now holds locally, when the push went through */
  status?: string
  error?: string
}

/**
 * Puts the number on the order, and nothing else.
 *
 * Split from the move to shipped on purpose. The two are separate requests at
 * MauDau anyway — sending the status inline with the number returns 200 and
 * changes nothing — and separating them lets the panel save a waybill straight
 * away and mark the order shipped a moment later, rather than making the
 * operator wait on the marketplace before the dialog will close.
 */
export async function pushTtnNumber(
  platform: string,
  externalId: string,
  ttn: string,
): Promise<PushTtnResult> {
  try {
    if (platform === 'maudau') {
      const numericId = externalId.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()
      // These two may already be behind us
      try { await patchMaudauStatus(numericId, 'accepted', undefined, jwt) } catch { /* already past */ }
      try { await patchMaudauStatus(numericId, 'approved', undefined, jwt) } catch { /* already past */ }
      await patchMaudauTtn(numericId, ttn, jwt)
      return { ok: true }
    }

    if (platform === 'rozetka') {
      // Rozetka takes the number only alongside its own status move, so its
      // number and status genuinely are one step
      return await pushTtnToMarketplace(platform, externalId, ttn)
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Marks the order shipped at the marketplace. MauDau only moves through its
 *  own status endpoint; the number must already be on the order. */
export async function markShippedAtMarketplace(
  platform: string,
  externalId: string,
): Promise<PushTtnResult> {
  try {
    if (platform === 'maudau') {
      await patchMaudauStatus(externalId.replace(/^MD-/, ''), 'delivering')
      return { ok: true, status: SHIPPED_STATUS.maudau }
    }
    // Rozetka was already moved when its number went over
    return { ok: true, status: SHIPPED_STATUS[platform] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pushTtnToMarketplace(
  platform: string,
  externalId: string,
  ttn: string,
): Promise<PushTtnResult> {
  try {
    if (platform === 'maudau') {
      // Spec: must chain accepted → approved, then number, then delivering
      const numericId = externalId.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()
      try { await patchMaudauStatus(numericId, 'accepted', undefined, jwt) } catch { /* already past */ }
      try { await patchMaudauStatus(numericId, 'approved', undefined, jwt) } catch { /* already past */ }

      // Two calls, deliberately: sending the status inline with the number
      // returns 200 and changes nothing
      await patchMaudauTtn(numericId, ttn, jwt)
      await patchMaudauStatus(numericId, 'delivering', undefined, jwt)
      return { ok: true, status: SHIPPED_STATUS.maudau }
    }

    if (platform === 'rozetka') {
      // Spec: chain 1 → 26 → 2, then set the number while moving to 3
      const numericId = externalId.replace(/^RZ-/, '')
      await advanceRozetka(numericId, 26) // Опрацьовується
      await advanceRozetka(numericId, 2)  // Комплектується

      const available = await rozetkaOrder(numericId)
      const transfer = available.find(s => s.child_id === 3)
      if (transfer) {
        await putRozetka(numericId, { status: transfer.child_id, ttn })
        return { ok: true, status: SHIPPED_STATUS.rozetka }
      }
      // Past that step already — the number can still be attached on its own,
      // but the status is not ours to claim
      await putRozetka(numericId, { ttn })
      return { ok: true }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
