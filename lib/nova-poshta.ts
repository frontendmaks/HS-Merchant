/**
 * Nova Poshta waybills.
 *
 * The request shape is not guessed — it mirrors a waybill the merchant created
 * themselves, read back through InternetDocument.getDocumentList: branch to
 * branch, paid by the recipient in cash, cargo type Parcel.
 */

const API = 'https://api.novaposhta.ua/v2.0/json/'

export interface NpSettings {
  sender_ref: string
  contact_sender_ref: string
  senders_phone: string
  city_sender_ref: string
  sender_address_ref: string
  default_description: string | null
  cargo_type: string | null
}

export interface WaybillInput {
  recipientName: string
  recipientPhone: string
  /** Nova Poshta refs, passed straight through from the marketplace order */
  cityRecipientRef: string
  /** Branch delivery. Absent for courier orders. */
  warehouseRecipientRef?: string | null
  /** Courier delivery: the street address from the order */
  street?: string | null
  building?: string | null
  flat?: string | null
  weightKg: number
  seats: number
  /** Declared value, UAH */
  cost: number
  description?: string
  /** Overrides the branch we ship from, which is not always the default one */
  senderAddressRef?: string | null
  /** Centimetres. Sent only when all three are given. */
  dimensions?: { length?: number; width?: number; height?: number } | null
  /** A parcel locker cannot take a waybill without dimensions */
  toPostomat?: boolean
}

export interface SenderWarehouse {
  ref: string
  description: string
}

/** Branches the sender can hand a parcel over at, for the dispatch dropdown. */
export async function senderWarehouses(cityRef: string): Promise<SenderWarehouse[]> {
  const r = await call<{ Ref: string; Description: string }>(
    'AddressGeneral', 'getWarehouses', { CityRef: cityRef, Page: '1', Limit: '500' })
  return (r.data ?? []).map(w => ({ ref: w.Ref, description: w.Description }))
}

/** Resolves a street name to Nova Poshta's own ref, then pins the address to
 *  the recipient — courier delivery is refused without an address ref. */
async function courierAddressRef(
  counterpartyRef: string,
  cityRef: string,
  street: string,
  building: string,
  flat?: string | null,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const found = await call<{ Ref: string; Description: string }>(
    'AddressGeneral', 'getStreet', { CityRef: cityRef, FindByString: street, Limit: '5' })

  const streetRef = found.data?.[0]?.Ref
  if (!streetRef) return { ok: false, error: `Нова Пошта не знайшла вулицю «${street}»` }

  const saved = await call<{ Ref: string }>('Address', 'save', {
    CounterpartyRef: counterpartyRef,
    StreetRef: streetRef,
    BuildingNumber: building,
    Flat: flat || '',
  })
  const ref = saved.data?.[0]?.Ref
  if (!ref) {
    return { ok: false, error: (saved.errors ?? []).join('; ') || 'Не вдалося зберегти адресу' }
  }
  return { ok: true, ref }
}

export interface WaybillResult {
  ok: boolean
  ttn?: string
  ref?: string
  cost?: number
  estimatedDelivery?: string
  error?: string
}

export const hasNpKey = () => !!process.env.NOVA_POSHTA_API_KEY

async function call<T>(modelName: string, calledMethod: string, methodProperties: unknown): Promise<{
  success: boolean
  data?: T[]
  errors?: string[]
}> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.NOVA_POSHTA_API_KEY,
      modelName,
      calledMethod,
      methodProperties,
    }),
  })
  return res.json()
}

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Marketplaces give "Прізвище Ім'я [По батькові]"; Nova Poshta wants the parts. */
export function splitName(full: string): { LastName: string; FirstName: string; MiddleName: string } {
  const parts = (full ?? '').trim().replace(/\s+/g, ' ').split(' ')
  return {
    LastName: parts[0] ?? '',
    FirstName: parts[1] ?? parts[0] ?? '',
    MiddleName: parts.slice(2).join(' '),
  }
}

/** Digits only, as Nova Poshta expects: 380XXXXXXXXX. */
const normalisePhone = (p: string) => (p ?? '').replace(/\D/g, '')

/**
 * A private recipient must exist as a counterparty before a waybill can name
 * them — passing RecipientName alone comes back "Recipient not selected".
 * Nova Poshta reuses an existing record when the phone already matches.
 */
async function ensureRecipient(name: string, phone: string): Promise<
  { ok: true; ref: string; contactRef: string } | { ok: false; error: string }
> {
  const parts = splitName(name)
  const res = await call<{ Ref: string; ContactPerson?: { data?: { Ref: string }[] } }>(
    'Counterparty', 'save', {
      ...parts,
      Phone: normalisePhone(phone),
      Email: '',
      CounterpartyType: 'PrivatePerson',
      CounterpartyProperty: 'Recipient',
    })

  if (!res.success) {
    return { ok: false, error: (res.errors ?? []).join('; ') || 'Не вдалося створити одержувача' }
  }
  const cp = res.data?.[0]
  const contactRef = cp?.ContactPerson?.data?.[0]?.Ref
  if (!cp?.Ref || !contactRef) {
    return { ok: false, error: 'Нова Пошта не повернула дані одержувача' }
  }
  return { ok: true, ref: cp.Ref, contactRef }
}

export async function createWaybill(
  settings: NpSettings,
  input: WaybillInput,
): Promise<WaybillResult> {
  if (!hasNpKey()) return { ok: false, error: 'NOVA_POSHTA_API_KEY не налаштовано' }

  const missing = (
    [['місто', input.cityRecipientRef], ['телефон', input.recipientPhone],
     ["ім'я", input.recipientName]] as const
  ).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { ok: false, error: `Бракує даних одержувача: ${missing.join(', ')}` }

  const toBranch = !!input.warehouseRecipientRef
  if (!toBranch && !(input.street && input.building)) {
    return { ok: false, error: 'Для курʼєрської доставки потрібні вулиця і будинок' }
  }
  if (input.toPostomat && !(input.dimensions?.length && input.dimensions.width && input.dimensions.height)) {
    return {
      ok: false,
      error: 'Для поштомата габарити обовʼязкові — Нова Пошта має знати, чи посилка влізе у комірку',
    }
  }

  const recipient = await ensureRecipient(input.recipientName, input.recipientPhone)
  if (!recipient.ok) return { ok: false, error: recipient.error }

  let recipientAddress = input.warehouseRecipientRef ?? ''
  if (!toBranch) {
    const addr = await courierAddressRef(
      recipient.ref, input.cityRecipientRef, input.street!, input.building!, input.flat)
    if (!addr.ok) return { ok: false, error: addr.error }
    recipientAddress = addr.ref
  }

  // Nova Poshta prices by volume as well as weight, so send it when we have it
  const dims = input.dimensions
  const hasDims = !!(dims?.length && dims.width && dims.height)
  const seats = Math.max(1, Math.round(input.seats))
  const volumePerSeat = hasDims
    ? (dims!.length! * dims!.width! * dims!.height!) / 1_000_000
    : 0
  const volumeGeneral = hasDims ? (volumePerSeat * seats).toFixed(4) : undefined

  // OptionsSeat describes each parcel separately. Nova Poshta rejects a
  // waybill that has neither this nor VolumeGeneral — "OptionsSeat is empty" —
  // and a parcel locker always needs the dimensions, since the door has to fit.
  const optionsSeat = Array.from({ length: seats }, () => ({
    weight: (input.weightKg / seats).toFixed(2),
    ...(hasDims ? {
      volumetricVolume: volumePerSeat.toFixed(4),
      volumetricWidth: String(Math.round(dims!.width!)),
      volumetricLength: String(Math.round(dims!.length!)),
      volumetricHeight: String(Math.round(dims!.height!)),
    } : {}),
  }))

  const result = await call<{
    Ref: string
    IntDocNumber: string
    CostOnSite: number
    EstimatedDeliveryDate: string
  }>('InternetDocument', 'save', {
    PayerType: 'Recipient',
    PaymentMethod: 'Cash',
    DateTime: today(),
    CargoType: settings.cargo_type || 'Parcel',
    Weight: input.weightKg.toFixed(2),
    ServiceType: toBranch ? 'WarehouseWarehouse' : 'WarehouseDoors',
    SeatsAmount: String(seats),
    OptionsSeat: optionsSeat,
    Description: input.description || settings.default_description || 'Продукти харчування',
    Cost: Math.max(1, Math.round(input.cost)).toString(),
    ...(volumeGeneral ? { VolumeGeneral: volumeGeneral } : {}),

    CitySender: settings.city_sender_ref,
    Sender: settings.sender_ref,
    SenderAddress: input.senderAddressRef || settings.sender_address_ref,
    ContactSender: settings.contact_sender_ref,
    SendersPhone: settings.senders_phone,

    CityRecipient: input.cityRecipientRef,
    Recipient: recipient.ref,
    RecipientAddress: recipientAddress,
    ContactRecipient: recipient.contactRef,
    RecipientsPhone: normalisePhone(input.recipientPhone),
  })

  if (!result.success) {
    return { ok: false, error: (result.errors ?? []).join('; ') || 'Невідома помилка Нової Пошти' }
  }

  const doc = result.data?.[0]
  return {
    ok: true,
    ttn: doc?.IntDocNumber,
    ref: doc?.Ref,
    cost: doc?.CostOnSite,
    estimatedDelivery: doc?.EstimatedDeliveryDate,
  }
}

/**
 * Removes a waybill that has not been handed over yet.
 *
 * Reports why rather than returning a bare false: a deletion that quietly
 * fails leaves a real waybill on the account, and the caller has no way to
 * know. Retried once, because a document deleted immediately after creation is
 * sometimes not ready yet.
 */
export async function deleteWaybill(ref: string): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call('InternetDocument', 'delete', { DocumentRefs: ref })
    if (r.success) return { ok: true }
    if (attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      continue
    }
    return { ok: false, error: (r.errors ?? []).join('; ') || 'Нова Пошта не пояснила відмову' }
  }
  return { ok: false, error: 'Не вдалося видалити накладну' }
}
