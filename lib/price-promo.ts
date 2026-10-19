/**
 * Штучна акція — вища стара ціна при незмінній новій.
 *
 * Маркетплейс показує перекреслену ціну поруч із чинною, і це видно в
 * списку. Знижки при цьому немає: міняється лише те, від чого відлічують,
 * тож правило тримаємо окремо від ціни товару. Ціна в каталозі лишається
 * однією правдою, це — оформлення вітрини.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export interface Promo {
  id: string
  feed_id: string | null
  scope: 'all' | 'category' | 'product'
  category_name: string | null
  product_id: string | null
  mode: 'percent' | 'amount'
  value: number
  note: string | null
}

/** Правила цього фіда плюс спільні для всіх. */
export async function loadPromos(service: Service, feedId: string): Promise<Promo[]> {
  const { data } = await service
    .from('price_promos')
    .select('id, feed_id, scope, category_name, product_id, mode, value, note')
    .eq('active', true)
    .or(`feed_id.eq.${feedId},feed_id.is.null`)

  return (data ?? []) as Promo[]
}

/**
 * Правило для товару — найточніше з наявних.
 *
 * Товар переважає категорію, категорія — «усі»; правило самого фіда
 * переважає спільне. Інакше акція на одну позицію губилась би під загальною,
 * і ніхто б не зрозумів, чому вона не діє.
 */
export function promoFor(
  promos: Promo[],
  product: { id: string; category_name?: string | null },
): Promo | null {
  const rank = (p: Promo) =>
    (p.scope === 'product' ? 4 : p.scope === 'category' ? 2 : 0) + (p.feed_id ? 1 : 0)

  const matching = promos.filter(p =>
    p.scope === 'all'
      || (p.scope === 'product' && p.product_id === product.id)
      || (p.scope === 'category' && !!product.category_name
          && p.category_name === product.category_name))

  return matching.sort((a, b) => rank(b) - rank(a))[0] ?? null
}

/**
 * Стара ціна за правилом.
 *
 * Рахується від уже порахованої ціни пропозиції, а не від ціни за кілограм:
 * перекреслене число має стояти в тих самих грошах, що й чинне, інакше
 * знижка виглядатиме десятикратною.
 */
export function promoOldPrice(price: number, promo: Promo | null): number | null {
  if (!promo || !(price > 0)) return null

  const raised = promo.mode === 'percent'
    ? price * (1 + Number(promo.value) / 100)
    : price + Number(promo.value)

  const rounded = Math.round(raised * 100) / 100
  return rounded > price ? rounded : null
}

/** Що показати як стару ціну: справжню знижку чи намальовану. */
export const oldPriceFor = (
  price: number,
  realOld: number | null,
  promo: Promo | null,
): number | null => {
  const painted = promoOldPrice(price, promo)
  const real = realOld && realOld > price ? realOld : null
  if (real && painted) return Math.max(real, painted)
  return real ?? painted
}
