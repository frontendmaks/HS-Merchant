/**
 * Бренд → виробник у довіднику Rozetka.
 *
 * Rozetka не приймає назву бренду текстом: у неї свій довідник на сто
 * п'ятдесят тисяч записів, і картка посилається на номер. Шукаємо за
 * точною назвою, бо «Галицька» і «Галицька Свіжина» — два різні записи,
 * і схожість тут не аргумент.
 *
 * Знайдене кладемо в `rozetka_producers`: довідник не міняється, а
 * запит на кожен бренд при кожному проході — це півсотні зайвих
 * звернень щогодини.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { rozetkaSearchProducers } from '@/lib/rozetka-api'

type Service = ReturnType<typeof createServiceClient>

const mem = new Map<string, number | null>()

export async function rozetkaProducerId(service: Service, brand: string): Promise<number | null> {
  const key = brand.trim()
  if (!key) return null
  if (mem.has(key)) return mem.get(key)!

  const { data } = await service
    .from('rozetka_producers').select('producer_id').eq('brand', key).maybeSingle()
  if (data?.producer_id != null) {
    mem.set(key, Number(data.producer_id))
    return Number(data.producer_id)
  }

  let found: number | null = null
  try {
    const rows = await rozetkaSearchProducers(key)
    /* Точний збіг або нічого: наблизити назву бренду означає повісити
       чужий бренд на свій товар, і модерація це зніме */
    const exact = rows.find(r => r.title.trim().toLowerCase() === key.toLowerCase())
    found = exact ? exact.id : null
  } catch {
    return null
  }

  await service.from('rozetka_producers').upsert({
    brand: key, producer_id: found, checked_at: new Date().toISOString(),
  })
  mem.set(key, found)
  return found
}
