/**
 * Чий опис товару головніший.
 *
 * Опис, вага й характеристики приїжджають із сайту, і нічна
 * синхронізація каталогу переписує їх цілком. Тому написане нами лежить
 * окремо — `description_own`, `weight_own`, `attrs_own` — і саме воно
 * має силу скрізь, де товар показують покупцю: у фідах, в API Rozetka,
 * у вивантаженні на МауДау.
 *
 * Порядок завжди один: наше → сайт. Не навпаки: сайт приносить порожнечу
 * частіше, ніж правду (двісті шістдесят сім товарів із чотирьохсот
 * прийшли без жодного рядка опису), а порожній опис на маркетплейсі —
 * це картка, яку не купують.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Product = any

/**
 * Назва товару: наша, якщо ми її писали.
 *
 * Rozetka відхиляє скорочення — сім карток повернулися з єдиним
 * коментарем модератора: «скорочення в назві». «в/г», «1/г», «с/к»,
 * «упак» розкриті в `name_own`, і саме воно їде на маркетплейси.
 */
export const nameFor = (p: Product): string =>
  (p?.name_own as string)?.trim() || (p?.name as string)?.trim() || ''

export const descriptionFor = (p: Product): string =>
  (p?.description_own as string)?.trim() || (p?.description as string)?.trim() || ''

/** Характеристики товару: наші дописані поверх тих, що з сайту. */
export function attrsFor(p: Product): Record<string, string> {
  return { ...((p?.attributes as Record<string, string>) ?? {}), ...((p?.attrs_own as Record<string, string>) ?? {}) }
}
