/** Order statuses grouped by who the order is waiting on.
 *
 *  MauDau and Rozetka use different wording for the same stages, so both
 *  vocabularies are listed together — the filter applies to either platform.
 */

/** Arrived, nobody has touched it yet. */
export const NEW_STATUSES = [
  'Нове',           // MauDau
  'Не оброблено',   // Rozetka
]

/** Taken up and being worked on, but not yet handed to the courier. */
export const PROCESSING_STATUSES = [
  'Прийнято', 'Узгоджено',                              // MauDau
  'Опрацьовується', 'Комплектується', 'Очікує оплату',  // Rozetka
]

/** Still on us: the order needs picking, confirming or handing to delivery. */
export const IN_PROGRESS_STATUSES = [...NEW_STATUSES, ...PROCESSING_STATUSES]

/** Already handed over — the courier has it, nothing for us to do. */
export const SHIPPING_STATUSES = [
  // MauDau
  'На доставці', 'Прибуло',
  // Rozetka
  'Передано в доставку', 'Доставляється', 'Чекає в пункті',
]

export const isInProgress = (status: string | null) =>
  !!status && IN_PROGRESS_STATUSES.includes(status)

export const isNew = (status: string | null) =>
  !!status && NEW_STATUSES.includes(status)

export const isProcessing = (status: string | null) =>
  !!status && PROCESSING_STATUSES.includes(status)

export const isShipping = (status: string | null) =>
  !!status && SHIPPING_STATUSES.includes(status)

/**
 * Once the order is agreed with the customer, what is in it is settled — the
 * composition has been confirmed and the picker is working from it. Editing
 * lines after that would change an order somebody has already promised.
 *
 * Rozetka words the same stage Комплектується.
 */
export const ITEMS_LOCKED_STATUSES = [
  // MauDau
  'Узгоджено', 'На доставці', 'Прибуло', 'Доставлено',
  // Rozetka
  'Комплектується', 'Передано в доставку', 'Доставляється', 'Чекає в пункті',
  // Nothing to correct on an order that is not happening
  'Скасовано',
]

export const canEditItems = (status: string | null | undefined): boolean =>
  !ITEMS_LOCKED_STATUSES.includes(status ?? '')

/**
 * Handed over: a waybill exists, so the parcel is with the courier and the
 * marketplace drives the order from here.
 *
 * The number alone decides this, not the status. The status is the
 * marketplace's to set and lags behind — an order can sit at Узгоджено with a
 * waybill already printed while the marketplace catches up, and during that
 * window the fields must already be closed. Tying the lock to the status meant
 * it let go every time a sync pulled an older value back.
 */
export const isHandedOver = (
  status: string | null | undefined,
  ttn: string | null | undefined,
): boolean => hasWaybill(ttn) || isShipping(status ?? null)

/** A real waybill number, not a note somebody left in the field — one order
 *  carries the text "нема товару" there, and that must not lock anything. */
export const hasWaybill = (ttn: string | null | undefined): boolean =>
  /^\d{10,}$/.test((ttn ?? '').replace(/\s/g, ''))

/**
 * A waybill is made once the order is agreed and its contents are settled —
 * the same point at which line editing closes. Before that the composition can
 * still change, and a waybill carrying the wrong weight or declared value has
 * to be cancelled and redone.
 *
 * Rozetka words the same stage Комплектується.
 */
export const READY_TO_SHIP_STATUSES = ['Узгоджено', 'Комплектується']

export const canCreateWaybill = (
  status: string | null | undefined,
  ttn: string | null | undefined,
): boolean => READY_TO_SHIP_STATUSES.includes(status ?? '') && !(ttn ?? '').trim()

// hasWaybill is declared below, next to the rule that uses it
