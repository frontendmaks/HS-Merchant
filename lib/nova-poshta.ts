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

/**
 * Nova Poshta's own boxes for parcel lockers, which is what a cell has to take.
 *
 * The API publishes no catalogue of cell sizes, only each locker's overall
 * ceiling, so these come from Nova Poshta's shop where the boxes are sold —
 * small and medium read off the product pages directly, large from their
 * listing. Sizes are the outside of the box, which is the figure that matters
 * for whether the door shuts.
 */
export interface CellPreset {
  key: 'small' | 'medium' | 'large'
  label: string
  length: number
  width: number
  height: number
}

export const CELL_PRESETS: CellPreset[] = [
  { key: 'small',  label: 'Мала',     length: 21, width: 11, height: 11 },
  { key: 'medium', label: 'Середня',  length: 33, width: 23, height: 11 },
  { key: 'large',  label: 'Велика',   length: 41, width: 33, height: 23 },
]

export interface WarehouseLimits {
  /** Centimetres the locker will accept */
  length: number | null
  width: number | null
  height: number | null
  maxWeightKg: number | null
  maxDeclaredCost: number | null
}

/** What one particular locker will take. Sizes differ between machines, so
 *  this is asked of the machine rather than assumed. */
export async function warehouseLimits(ref: string): Promise<WarehouseLimits | null> {
  const r = await call<{
    ReceivingLimitationsOnDimensions?: { Width?: number; Height?: number; Length?: number }
    TotalMaxWeightAllowed?: string | number
    MaxDeclaredCost?: string | number
  }>('AddressGeneral', 'getWarehouses', { Ref: ref })

  const w = r.data?.[0]
  if (!w) return null
  const d = w.ReceivingLimitationsOnDimensions ?? {}
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  return {
    length: num(d.Length),
    width: num(d.Width),
    height: num(d.Height),
    maxWeightKg: num(w.TotalMaxWeightAllowed),
    maxDeclaredCost: num(w.MaxDeclaredCost),
  }
}

/** Branches the sender can hand a parcel over at, for the dispatch dropdown. */
export async function senderWarehouses(cityRef: string): Promise<SenderWarehouse[]> {
  const r = await call<{ Ref: string; Description: string }>(
    'AddressGeneral', 'getWarehouses', { CityRef: cityRef, Page: '1', Limit: '500' })
  return (r.data ?? []).map(w => ({ ref: w.Ref, description: w.Description }))
}

/**
 * The delivery-city ref a settlement belongs to.
 *
 * The marketplaces hand over a *settlement* ref. Streets live under a *city*
 * ref, and for a village that is the ref of the town its post is delivered
 * through — a different value, which only searchSettlements reports and only
 * alongside the name, so the settlement has to be named first and then matched
 * back by ref. getSettlements does not carry it.
 */
async function deliveryCityRef(settlementRef: string): Promise<string | null> {
  const settlement = await call<{ Description: string }>(
    'AddressGeneral', 'getSettlements', { Ref: settlementRef, Limit: '1' })
  const name = settlement.data?.[0]?.Description
  if (!name) return null

  // The name is not unique — there are three villages called Безводне — so the
  // right row is the one whose own ref matches, not the first that comes back
  const found = await call<{ Addresses?: { Ref: string; DeliveryCity: string }[] }>(
    'AddressGeneral', 'searchSettlements', { CityName: name, Limit: '150' })

  return found.data?.[0]?.Addresses?.find(a => a.Ref === settlementRef)?.DeliveryCity || null
}

/** Apostrophes and case differ between the marketplaces and Nova Poshta. */
const foldPlace = (s: string) =>
  s.trim().toLowerCase().replace(/[\u2019\u02bc\u2018`']/g, "'").replace(/\s+/g, ' ')

export type CityLookup =
  | { ok: true; ref: string; present: string }
  | { ok: false; error: string }

/**
 * A Nova Poshta city ref for a settlement we know only by name.
 *
 * MauDau sends a ref only when the buyer picked a Nova Poshta branch. Inside
 * its own courier zone it sends the name and nothing else, which is where
 * waybill creation used to stop.
 *
 * A name alone is not an identity — three settlements are called Львів. What
 * separates them here is that courier delivery needs a street, and only one of
 * the three has streets at all, so that is the filter rather than a guess at
 * which is biggest. If more than one survives it, say so instead of picking:
 * the wrong choice sends the parcel to another oblast.
 */
export async function cityRefByName(name: string): Promise<CityLookup> {
  const wanted = foldPlace(name)
  if (!wanted) return { ok: false, error: 'Місто одержувача не вказано' }

  const found = await call<{
    Addresses?: {
      Ref: string; DeliveryCity: string; MainDescription: string
      Present: string; StreetsAvailability: boolean
    }[]
  }>('AddressGeneral', 'searchSettlements', { CityName: name, Limit: '50' })

  const all = found.data?.[0]?.Addresses ?? []
  // searchSettlements answers on similarity, so "Львів" also brings back
  // Львівка and Миколаїв — only an exact name is the place that was meant
  const exact = all.filter(a => foldPlace(a.MainDescription) === wanted)
  const withStreets = exact.filter(a => a.StreetsAvailability && a.DeliveryCity)

  if (withStreets.length === 1) {
    return { ok: true, ref: withStreets[0].DeliveryCity, present: withStreets[0].Present }
  }
  if (withStreets.length === 0) {
    return {
      ok: false,
      error: exact.length
        ? `Нова Пошта не має вулиць у «${name}» — курʼєрська доставка туди неможлива`
        : `Нова Пошта не знає населеного пункту «${name}»`,
    }
  }
  return {
    ok: false,
    error: `Назва «${name}» неоднозначна: ${withStreets.map(a => a.Present).join('; ')}. ` +
      'Оберіть місто вручну.',
  }
}

/**
 * Finds a street, given whichever kind of ref the marketplace supplied.
 *
 * A city ref works straight away. A settlement ref does not: getStreet answers
 * "City not found", which reads as though the street were missing and sends
 * you looking in the wrong place. So that case resolves the delivery city
 * first and asks again.
 *
 * searchSettlementStreets does find such streets, but the ref it returns is a
 * settlement-street ref, and Address.save refuses it with "Street doesn't
 * exists" — so it is no use here.
 */
async function findStreetRef(ref: string, street: string): Promise<string | null> {
  const direct = await streetRefIn(ref, street)
  if (direct) return direct

  const cityRef = await deliveryCityRef(ref)
  if (!cityRef) return null

  return await streetRefIn(cityRef, street)
}

/**
 * One city, one street name — with the name as written and then shortened.
 *
 * getStreet matches from the start of its own description, so a name carrying
 * a word Nova Poshta does not have finds nothing at all: the marketplace sends
 * "Грабовського Павла", Nova Poshta stores "Грабовського". Dropping words from
 * the end recovers those, but a shortened name is a weaker claim — "Володимира
 * Великого" cut to "Володимира" would match several streets — so a trimmed
 * query is accepted only when exactly one street answers it.
 */
async function streetRefIn(cityRef: string, street: string): Promise<string | null> {
  const words = street.trim().split(/\s+/).filter(Boolean)

  for (let take = words.length; take > 0; take--) {
    const r = await call<{ Ref: string }>('AddressGeneral', 'getStreet',
      { CityRef: cityRef, FindByString: words.slice(0, take).join(' '), Limit: '10' })
    const hits = r.data ?? []
    if (!hits.length) continue
    // The name exactly as the marketplace gave it — trust the best match
    if (take === words.length) return hits[0].Ref
    // Shortened, and more than one street fits: refuse rather than guess
    return hits.length === 1 ? hits[0].Ref : null
  }
  return null
}

/** Pins a street address to the recipient — courier delivery is refused
 *  without an address ref of their own. */
async function courierAddressRef(
  counterpartyRef: string,
  cityRef: string,
  street: string,
  building: string,
  flat?: string | null,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const streetRef = await findStreetRef(cityRef, street)
  if (!streetRef) {
    return {
      ok: false,
      error: `Нова Пошта не знайшла вулицю «${street}» у цьому населеному пункті`,
    }
  }

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

  // OptionsSeat describes each parcel separately, and Nova Poshta wants every
  // field of it or none of the block: sending weight alone comes back
  // "OptionsSeat is empty or one of option is empty", which also refuses the
  // branch deliveries that were working before. Without dimensions we send
  // neither this nor VolumeGeneral and let Nova Poshta price by weight, as it
  // always did — a parcel locker is the case that genuinely needs them, and is
  // required to supply them earlier.
  const optionsSeat = hasDims
    ? Array.from({ length: seats }, () => ({
        weight: (input.weightKg / seats).toFixed(2),
        volumetricVolume: volumePerSeat.toFixed(4),
        volumetricWidth: String(Math.round(dims!.width!)),
        volumetricLength: String(Math.round(dims!.length!)),
        volumetricHeight: String(Math.round(dims!.height!)),
      }))
    : null

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
    ...(optionsSeat ? { OptionsSeat: optionsSeat } : {}),
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
