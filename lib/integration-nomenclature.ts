/**
 * Який саме товар стоїть у рядку замовлення.
 *
 * Рядок може нести три різні речі в полі ідентифікатора: справжній зв'язок із
 * каталогом, ідентифікатор сайту («883215») або артикул («K0209») — залежно
 * від того, що прислав маркетплейс. Жодне з них саме по собі не достатнє.
 *
 * Артикул до того ж не унікальний: «Ковбаса Любительська в/г» і та сама
 * ковбаса в упаковці мають один артикул К0020, але це дві різні позиції
 * номенклатури з різними uid у 1С. Розводить їх назва — і результат завжди
 * повідомляє, наскільки впевнено його знайдено.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { foldSku, skuVariants } from '@/lib/order-items'

type Service = ReturnType<typeof createServiceClient>

export interface CatalogRow {
  id: string
  external_id: string | null
  sku: string | null
  name: string | null
  uid_1c: string | null
  code_1c: string | null
}

/** Як саме знайдено товар — щоб приймач знав, чому вірити. */
export type MatchBy = 'product_id' | 'external_id' | 'sku' | 'sku+title' | null

export interface Resolved {
  product: CatalogRow | null
  match_by: MatchBy
  /** Артикул вказує на кілька позицій 1С, і вибір зроблено за назвою */
  ambiguous: boolean
}

export interface Resolver {
  resolve(line: {
    product_id?: string | null
    product_external_id?: string | null
    title?: string | null
  }): Resolved
}

const norm = (s: string) => s.toLowerCase().replace(/[«»"“”]/g, '"').replace(/\s+/g, ' ').trim()

/**
 * Наскільки назва з каталогу пасує до назви в замовленні.
 *
 * Спільний початок сам по собі не розводить «Ковбаски Мисливські 1/г» і
 * «…1/г, упак»: обидві розходяться з назвою замовлення в тому самому місці.
 * Вирішує входження — назва каталогу має бути частиною назви замовлення, і з
 * двох таких виграє довша.
 */
function titleScore(catalogName: string, orderTitle: string): number {
  const a = norm(catalogName), b = norm(orderTitle)
  if (!a) return 0
  if (b.includes(a)) return 1000 + a.length

  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * Читає каталог один раз на всю вибірку й повертає пошукач.
 *
 * Запит на кожен рядок окремо перетворював сторінку з двохсот замовлень на
 * тисячу звернень до бази.
 */
export async function buildResolver(
  service: Service,
  lines: { product_id?: string | null; product_external_id?: string | null }[],
): Promise<Resolver> {
  const ids = [...new Set(lines.map(l => l.product_id).filter(Boolean) as string[])]
  const refs = [...new Set(lines.flatMap(l => skuVariants(l.product_external_id)))]

  const [{ data: byIdRows }, { data: byRefRows }] = await Promise.all([
    ids.length
      ? service.from('products')
          .select('id, external_id, sku, name, uid_1c, code_1c').in('id', ids)
      : Promise.resolve({ data: [] as CatalogRow[] }),
    refs.length
      ? service.from('products')
          .select('id, external_id, sku, name, uid_1c, code_1c')
          .or(`external_id.in.(${refs.join(',')}),sku.in.(${refs.join(',')})`)
      : Promise.resolve({ data: [] as CatalogRow[] }),
  ])

  const all = [...(byIdRows ?? []), ...(byRefRows ?? [])] as CatalogRow[]

  const byUuid = new Map<string, CatalogRow>()
  const byExternal = new Map<string, CatalogRow>()
  /** Артикул може вказувати на кілька позицій — тримаємо всі */
  const bySku = new Map<string, CatalogRow[]>()

  for (const p of all) {
    byUuid.set(p.id, p)
    if (p.external_id) byExternal.set(p.external_id, p)
    if (p.sku) {
      const key = foldSku(p.sku)
      bySku.set(key, [...(bySku.get(key) ?? []).filter(x => x.id !== p.id), p])
    }
  }

  return {
    resolve(line) {
      // 1. Справжній зв'язок із каталогом — сумнівів немає
      if (line.product_id) {
        const hit = byUuid.get(line.product_id)
        if (hit) {
          // Артикул може бути спільний на кілька позицій 1С. Зв'язок у базі
          // лишається головним — його ж показує оператор у Мерчанті, — але
          // приймач має знати, що артикул тут не розрізняє товари.
          const shared = hit.sku
            ? (bySku.get(foldSku(hit.sku)) ?? []).length > 1
            : false
          return { product: hit, match_by: 'product_id', ambiguous: shared }
        }
      }

      const ref = (line.product_external_id ?? '').trim()
      if (!ref) return { product: null, match_by: null, ambiguous: false }

      // 2. Ідентифікатор сайту — теж однозначний
      const direct = byExternal.get(ref)
      if (direct) return { product: direct, match_by: 'external_id', ambiguous: false }

      // 3. Артикул. Один — добре; кілька — розводимо за назвою
      const candidates = bySku.get(foldSku(ref)) ?? []
      if (!candidates.length) return { product: null, match_by: null, ambiguous: false }
      if (candidates.length === 1) {
        return { product: candidates[0], match_by: 'sku', ambiguous: false }
      }

      const title = line.title ?? ''
      const best = [...candidates]
        .sort((a, b) => titleScore(b.name ?? '', title) - titleScore(a.name ?? '', title))[0]

      return { product: best, match_by: 'sku+title', ambiguous: true }
    },
  }
}
