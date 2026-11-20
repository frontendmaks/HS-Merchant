/**
 * Години доставки складу — такі, якими їх бачить покупець.
 *
 * Період у замовленні доходить до нас через угоду Бітрікса, а там він
 * числом: 26, 27, 345. Підпис до числа Бітрікс тримає один на весь
 * портал — «14:00 — 17:00». Та сайт тримає години **по складах**, і з
 * 16 листопада Гуртівня возить інакше за решту: її 27 — це «14:00 —
 * 18:00», а 345 — «18:00 — 20:00». Номери лишились чужі, спільні.
 *
 * Виходило, що клієнтові Гуртівні на сайті обіцяли одне вікно, а склад
 * і кур'єр у Мерчанті читали інше — на годину коротше. За два дні сорок
 * вісім замовлень.
 *
 * Полагодити це в Бітріксі має адміністратор порталу: додати два
 * значення й дати Гуртівні власні номери на сайті. Доти питаємо
 * першоджерело — той самий запит, яким Мерчант бере карту зон. Що сайт
 * показав покупцеві, те й пишемо в замовлення.
 *
 * Після того, як номери стануть власними, цей шлях не завадить: він і
 * тоді відповість те саме, лише без двозначності.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeSlot } from '@/lib/bitrix-slots'

type Service = ReturnType<typeof createServiceClient>

const CITY_DATA_URL =
  'https://halytska-svizhyna.ua/wp-admin/admin-ajax.php?action=get_city_data&city=' +
  encodeURIComponent('Львів') + '&lang=uk'

/** Ключ, під яким копія годин лежить у налаштуваннях */
export const SHOP_HOURS_KEY = 'shop_delivery_hours'

/** Склад → номер періоду → підпис: `{ 'Гуртівня онлайн': { '27': '14:00-18:00' } }` */
export type ShopHours = Record<string, Record<string, string>>

/** «  Гуртівня  Онлайн » і «Гуртівня онлайн» — один склад */
const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

interface CityShop {
  title?: string
  shop_delivery_hours?: { id?: string; from?: string; to?: string }[] | false
}

/** Години з відповіді сайту. Чистий розбір — без мережі й без бази */
export function hoursFromCityData(data: { shops?: CityShop[] } | null): ShopHours {
  const out: ShopHours = {}
  for (const shop of data?.shops ?? []) {
    const name = (shop.title ?? '').trim()
    const rows = Array.isArray(shop.shop_delivery_hours) ? shop.shop_delivery_hours : []
    if (!name || !rows.length) continue

    const slots: Record<string, string> = {}
    for (const row of rows) {
      const id = String(row?.id ?? '').trim()
      const from = String(row?.from ?? '').trim()
      const to = String(row?.to ?? '').trim()
      // Півперіоду — не період: краще лишити число Бітріксу, ніж писати «14:00-»
      if (!id || !from || !to) continue
      slots[id] = normalizeSlot(`${from} - ${to}`)
    }
    if (Object.keys(slots).length) out[key(name)] = slots
  }
  return out
}

/** Підпис періоду для цього складу, або null — тоді питаємо Бітрікс */
export function slotFromShopHours(
  hours: ShopHours | null | undefined,
  warehouse: string | null | undefined,
  slotId: string | null | undefined,
): string | null {
  const id = String(slotId ?? '').trim()
  if (!hours || !warehouse || !id || id === '0') return null
  return hours[key(warehouse)]?.[id] ?? null
}

/**
 * Перепитуємо сайт і кладемо копію собі.
 *
 * Копія потрібна тому, що синхронізація ходить щотри хвилини, а години
 * міняють раз на місяць: тягнути їх щоразу означало б сорок зайвих
 * запитів на годину до сайту, який і так віддає нам товари.
 */
export async function refreshShopHours(
  service: Service,
): Promise<{ shops: number; slots: number; error?: string }> {
  try {
    const res = await fetch(CITY_DATA_URL, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { shops: 0, slots: 0, error: `Сайт відповів ${res.status}` }

    const hours = hoursFromCityData(await res.json())
    const shops = Object.keys(hours).length
    /*
     * Порожня відповідь — це збій сайту, а не склади без годин.
     * Затирати нею свою копію означало б лишитись без підписів узагалі.
     */
    if (!shops) return { shops: 0, slots: 0, error: 'Сайт не віддав жодного складу з годинами' }

    await service.from('app_settings').upsert({
      key: SHOP_HOURS_KEY, value: hours, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

    return { shops, slots: Object.values(hours).reduce((n, s) => n + Object.keys(s).length, 0) }
  } catch (e) {
    return { shops: 0, slots: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Копія годин із налаштувань. Порожньо — значить, покладаємось на Бітрікс */
export async function loadShopHours(service: Service): Promise<ShopHours> {
  const { data } = await service
    .from('app_settings').select('value').eq('key', SHOP_HOURS_KEY).maybeSingle()
  return (data?.value as ShopHours | null) ?? {}
}
