/** Order statuses grouped by who the order is waiting on.
 *
 *  MauDau and Rozetka use different wording for the same stages, so both
 *  vocabularies are listed together — the filter applies to either platform.
 */

/** Still on us: the order needs picking, confirming or handing to delivery. */
export const IN_PROGRESS_STATUSES = [
  // MauDau
  'Нове', 'Прийнято', 'Узгоджено',
  // Rozetka
  'Опрацьовується', 'Комплектується', 'Очікує оплату', 'Не оброблено',
]

/** Already handed over — the courier has it, nothing for us to do. */
export const SHIPPING_STATUSES = [
  // MauDau
  'На доставці', 'Прибуло',
  // Rozetka
  'Передано в доставку', 'Доставляється', 'Чекає в пункті',
]

export const isInProgress = (status: string | null) =>
  !!status && IN_PROGRESS_STATUSES.includes(status)

export const isShipping = (status: string | null) =>
  !!status && SHIPPING_STATUSES.includes(status)
