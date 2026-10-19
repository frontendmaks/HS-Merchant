/**
 * Ручні замовлення — ті, що приходять телефоном.
 *
 * Зберігаються в тій самій таблиці, що й маркетплейсні, з платформою
 * «manual». Так їм дістається все наявне: статуси, оплата, ТТН, журнал,
 * вивантаження в Бітрікс. Окрема таблиця означала б другу копію кожного
 * правила — і другий набір помилок у них.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export const MANUAL_PLATFORM = 'manual'

/**
 * Наступний порядковий номер на день.
 *
 * Номер щодня починається з одиниці — так його веде паперовий журнал, і так
 * його звикли називати в розмові: «замовлення сімнадцяте». Унікальність
 * тримає індекс у базі, тож двоє операторів одночасно не отримають один
 * номер — другий просто візьме наступний.
 */
export async function nextManualNumber(
  service: Service,
  deliveryDate: string,
): Promise<number> {
  const { data } = await service
    .from('orders')
    .select('manual_number')
    .eq('platform', MANUAL_PLATFORM)
    .eq('delivery_date', deliveryDate)
    .order('manual_number', { ascending: false })
    .limit(1)

  const last = data?.[0]?.manual_number
  return (typeof last === 'number' ? last : 0) + 1
}

/** Номер замовлення, який бачить людина: МР-19.10-17. */
export function manualExternalId(deliveryDate: string, number: number): string {
  const [, m, d] = deliveryDate.split('-')
  return `МР-${d}.${m}-${number}`
}

export interface ManualLine {
  /** Товар із каталогу; порожньо — рядок, вписаний вручну */
  product_id?: string | null
  /** Товар у каталозі Бітрікса — у позицій, що приїхали звідти */
  bitrix_product_id?: number | null
  title: string
  unit: string
  unit_weight: number
  price_per_unit: number
  /** Скільки замовлено, в одиниці рядка */
  qty: number
}

export interface ManualOrderInput {
  customer_name: string
  customer_phone: string
  address: string
  warehouse: string | null
  delivery_zone: string | null
  delivery_date: string
  delivery_slot: string
  comment?: string | null
  lines: ManualLine[]
}

export const lineTotal = (l: ManualLine) =>
  Math.round(l.qty * l.price_per_unit * 100) / 100

export const orderTotal = (lines: ManualLine[]) =>
  Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100

/**
 * Вага замовлення для накладної.
 *
 * Вагові рядки вже в кілограмах. Штучні — кількість помножена на вагу пачки;
 * якщо вага невідома, береться той самий припущений вес, що й для
 * маркетплейсних замовлень, аби дві частини системи не розходились.
 */
const UNKNOWN_PIECE_KG = 0.4

export function manualWeight(lines: ManualLine[]): number {
  let kg = 0
  for (const l of lines) {
    kg += l.unit === 'кг'
      ? l.qty
      : l.qty * (l.unit_weight > 0 ? l.unit_weight : UNKNOWN_PIECE_KG)
  }
  return Math.round(kg * 1000) / 1000
}
