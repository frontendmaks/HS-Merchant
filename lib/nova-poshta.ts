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
  warehouseRecipientRef: string
  weightKg: number
  seats: number
  /** Declared value, UAH */
  cost: number
  description?: string
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
    [['cityRecipientRef', input.cityRecipientRef], ['warehouseRecipientRef', input.warehouseRecipientRef],
     ['recipientPhone', input.recipientPhone], ['recipientName', input.recipientName]] as const
  ).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { ok: false, error: `Бракує даних одержувача: ${missing.join(', ')}` }

  const recipient = await ensureRecipient(input.recipientName, input.recipientPhone)
  if (!recipient.ok) return { ok: false, error: recipient.error }

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
    ServiceType: 'WarehouseWarehouse',
    SeatsAmount: String(Math.max(1, Math.round(input.seats))),
    Description: input.description || settings.default_description || 'Продукти харчування',
    Cost: Math.max(1, Math.round(input.cost)).toString(),

    CitySender: settings.city_sender_ref,
    Sender: settings.sender_ref,
    SenderAddress: settings.sender_address_ref,
    ContactSender: settings.contact_sender_ref,
    SendersPhone: settings.senders_phone,

    CityRecipient: input.cityRecipientRef,
    Recipient: recipient.ref,
    RecipientAddress: input.warehouseRecipientRef,
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

/** Removes a waybill that has not been handed over yet. */
export async function deleteWaybill(ref: string): Promise<boolean> {
  const r = await call('InternetDocument', 'delete', { DocumentRefs: ref })
  return !!r.success
}
