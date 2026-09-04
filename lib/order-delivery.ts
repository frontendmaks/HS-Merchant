/**
 * Where a parcel is going, read out of the marketplace's own payload.
 *
 * Shared by the two halves of the shipment route so that what the dialog
 * checks and what the waybill is built from cannot drift apart.
 */

export interface Destination {
  /** Nova Poshta's ref, when the marketplace supplied one */
  cityRef: string | null
  cityName: string | null
  warehouseRef: string | null
  street: string | null
  building: string | null
  flat: string | null
  toBranch: boolean
  toPostomat: boolean
  /** The marketplace is having this delivered itself — it will not take a
   *  tracking number for it, and never supplies a carrier id either */
  byMerchant: boolean
}

interface ExternalId { id?: string | null; delivery_provider?: string | null }

/**
 * The Nova Poshta id out of a marketplace's list of them.
 *
 * The list holds one entry per delivery provider and the entry for our own
 * courier zone carries a null id, so position says nothing — the provider does.
 */
function npExternalId(ids: unknown): string | null {
  const list = Array.isArray(ids) ? (ids as ExternalId[]) : []
  const byName = list.find(e => e?.id && /nova/i.test(e.delivery_provider ?? ''))
  return byName?.id ?? list.find(e => e?.id)?.id ?? null
}

/** Which delivery this order belongs to, as the marketplace sees it. */
function providerOf(ids: unknown): string | null {
  const list = Array.isArray(ids) ? (ids as ExternalId[]) : []
  return list[0]?.delivery_provider ?? null
}

export function readDestination(
  raw: Record<string, unknown> | null,
  branchLabel?: string | null,
): Destination {
  const delivery = (raw?.delivery_address ?? {}) as Record<string, unknown>
  const city = (delivery.city ?? {}) as Record<string, unknown>
  const warehouse = (delivery.warehouse ?? {}) as Record<string, unknown>
  const street = (delivery.street ?? {}) as Record<string, unknown>

  const warehouseRef = (warehouse.external_id as string | undefined) ?? null

  return {
    cityRef: npExternalId(city.external_ids),
    cityName: (city.name as string | undefined)?.trim() || null,
    warehouseRef,
    street: (street.name as string | undefined)?.trim() || null,
    building: (delivery.building as string | undefined) ?? null,
    flat: (delivery.apartment as string | undefined) ?? null,
    toBranch: !!warehouseRef,
    toPostomat: (warehouse.type as string) === 'parcel_locker'
      || /поштомат/i.test(String(branchLabel ?? '')),
    byMerchant: providerOf(city.external_ids) === 'merchant',
  }
}
