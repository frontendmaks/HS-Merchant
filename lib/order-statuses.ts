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
 * Handed to the courier and carrying a number: the waybill exists, the parcel
 * is moving, and the marketplace drives the status from here.
 *
 * Both halves matter. A shipping status without a number means the waybill
 * still has to be made; a number on an order not yet shipped is one an operator
 * typed ahead of time.
 */
export const isHandedOver = (
  status: string | null | undefined,
  ttn: string | null | undefined,
): boolean => isShipping(status ?? null) && !!(ttn ?? '').trim()
