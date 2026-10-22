/**
 * Вартість доставки.
 *
 * Замовлення до тисячі гривень везуть за 50 ₴, дорожчі — безкоштовно. Поріг
 * рахується від товарів, без самої доставки: інакше замовлення на 980 ₴ з
 * доставкою перевалило б за тисячу й доставку б собі скасувало.
 *
 * У CRM це не поле зі знижкою, а звичайний рядок замовлення — той самий
 * товар «Доставка замовлення», що його додає сайт. Так доставку видно і в
 * бланку складу, і в сумі, і нічого не треба лічити двічі.
 */
import type { ManualLine } from '@/lib/manual-orders'

export const DELIVERY_TITLE = 'Доставка замовлення'
export const DELIVERY_FEE = 50
/** Понад цю суму (не включно) доставка безкоштовна */
export const FREE_DELIVERY_FROM = 1000
/** Той самий товар у каталозі Бітрікса, яким доставку проводить сайт */
export const BITRIX_DELIVERY_PRODUCT_ID = 20030

export const isDeliveryLine = (l: { title: string }) =>
  l.title.trim() === DELIVERY_TITLE

/**
 * Чиєї доставки стосується це правило.
 *
 * Нашої — тієї, що возить наш кур'єр за нашим графіком: сайт і телефон.
 * Маркетплейсне замовлення везе майданчик, його умови доставки домовлені
 * з покупцем там, і ціна вже порахована в чеку, який покупець бачив.
 * Дописати туди свої п'ятдесят гривень означає виставити рахунок за те,
 * про що з людиною ніхто не говорив, — а поріг у тисячу там не значить
 * нічого, бо рахує майданчик по-своєму.
 */
export const chargesOwnDelivery = (platform: string | null | undefined) =>
  platform === 'site' || platform === 'manual'

/** Сума товарів без доставки. */
export function goodsTotal(lines: ManualLine[]): number {
  const sum = lines
    .filter(l => !isDeliveryLine(l))
    .reduce((s, l) => s + l.qty * l.price_per_unit, 0)
  return Math.round(sum * 100) / 100
}

export const deliveryFeeFor = (lines: ManualLine[]): number =>
  goodsTotal(lines) > FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE

/**
 * Додає рядок доставки, якщо він належиться.
 *
 * Якщо рядок уже є — не дублюємо, а перераховуємо: оператор міг дозамовити
 * товарів і перетнути поріг, поки складав замовлення.
 */
export function withDelivery(lines: ManualLine[]): ManualLine[] {
  const goods = lines.filter(l => !isDeliveryLine(l))
  const fee = deliveryFeeFor(goods)
  if (!fee) return goods

  return [...goods, {
    product_id: null,
    title: DELIVERY_TITLE,
    unit: 'шт',
    // Доставка нічого не важить — у вагу замовлення вона не йде
    unit_weight: 0,
    price_per_unit: fee,
    qty: 1,
  }]
}
