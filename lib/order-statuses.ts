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
