export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase/service'
import PricesClient from './PricesClient'

export default async function PriceMonitorPage() {
  const role = await getCurrentRole()
  if (!canAccess('priceMonitor', role)) redirect('/analytics')

  const service = createServiceClient()

  const [{ data: competitors }, { data: watches }, { data: matches }] = await Promise.all([
    service.from('price_competitors')
      .select('id, name, site_url, search_url, is_active, last_checked_at, last_error')
      .order('created_at'),
    service.from('price_watches')
      .select('product_id, added_at, product:products(id, name, price, category_name, stock, status)')
      .order('added_at', { ascending: false }),
    service.from('price_matches')
      .select('id, product_id, competitor_id, competitor_title, competitor_url, price, similarity, status, checked_at, error'),
  ])

  // Yesterday's price per pair, so a move can be shown rather than just a level
  const { data: history } = await service
    .from('price_snapshots')
    .select('product_id, competitor_id, price, captured_at')
    .gte('captured_at', new Date(Date.now() - 30 * 864e5).toISOString())
    .order('captured_at', { ascending: false })
    .limit(4000)

  return (
    <PricesClient
      competitors={competitors ?? []}
      watches={(watches ?? []) as never}
      matches={matches ?? []}
      history={history ?? []}
    />
  )
}
