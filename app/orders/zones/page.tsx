import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { dayKindFor, ZONES_URL, type Point } from '@/lib/delivery-zones'
import { SUNDAY_MAP_ID } from '@/lib/sunday-zones'
import ZonesView, { type DayMap } from './ZonesView'

export const dynamic = 'force-dynamic'

/**
 * Зони доставки — обидві карти, як їх бачить Мерчант.
 *
 * Склад замовленню призначає не людина, а точка на карті, і доти цю карту
 * ніде не можна було побачити: межі живуть у налаштуваннях сайту та в
 * Google My Maps, а в нас — копією в базі. Коли адресі діставався
 * несподіваний склад або «поза зонами», лишалось вірити на слово.
 *
 * Тут видно саме нашу копію — ту, за якою Мерчант і вирішує, — і коли її
 * востаннє звіряли з першоджерелом.
 */
export default async function ZonesPage() {
  const role = await getCurrentRole()
  if (!canAccess('orders', role)) redirect('/')

  const service = createServiceClient()
  const { data } = await service
    .from('delivery_zones')
    .select('day_kind, code, warehouse, polygon, updated_at')
    .order('day_kind')
    .order('code')

  const rows = data ?? []
  const of = (kind: 'weekday' | 'sunday') => rows.filter(r => r.day_kind === kind)

  const build = (
    kind: 'weekday' | 'sunday', label: string, source: string, sourceUrl: string,
  ): DayMap => {
    const mine = of(kind)
    return {
      kind, label, source, sourceUrl,
      updatedAt: mine.map(r => r.updated_at as string | null)
        .filter(Boolean).sort().at(-1) ?? null,
      zones: mine.map(r => ({
        code: r.code as string,
        warehouse: r.warehouse as string,
        polygon: (r.polygon as Point[]) ?? [],
      })),
    }
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Зони доставки</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          За цими межами Мерчант обирає склад. У неділю карта інша
        </p>
      </div>

      <ZonesView
        today={dayKindFor(today)}
        maps={[
          build('weekday', 'Будні', 'карта зон на сайті', ZONES_URL),
          build('sunday', 'Неділя', 'Google My Maps «Карта Неділя»',
            `https://www.google.com/maps/d/viewer?mid=${SUNDAY_MAP_ID}`),
        ]}
      />
    </div>
  )
}
