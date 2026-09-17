export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { currentActor } from '@/lib/order-events'
import { canDecideRemoval } from '@/lib/product-removal'
import RemovalsClient from './RemovalsClient'

export default async function RemovalsPage() {
  const role = await getCurrentRole()
  if (!canAccess('productRemovals', role)) redirect('/products')

  const actor = await currentActor()
  const supabase = createServiceClient()

  const [{ data: requests }, products, { data: feeds }] = await Promise.all([
    supabase
      .from('product_removal_requests')
      .select(`*,
        author:profiles!product_removal_requests_created_by_fkey(full_name, email),
        decider:profiles!product_removal_requests_decided_by_fkey(full_name, email),
        items:product_removal_items(product_id, product_name),
        events:product_removal_events(id, type, actor_name, old_value, new_value, created_at)`)
      .order('created_at', { ascending: false })
      .limit(200),
    // Only what the picker needs — the full product rows are large and most of
    // their columns say nothing about whether to stop selling one
    fetchAllRows(() =>
      supabase
        .from('products')
        .select('id, name, sku, category_name, stock, status, withdrawn_at')
        .order('name')
    ),
    supabase.from('feeds').select('id, name').order('name'),
  ])

  return (
    <RemovalsClient
      requests={requests ?? []}
      products={products ?? []}
      feeds={feeds ?? []}
      canDecide={canDecideRemoval(role)}
      meId={actor?.id ?? null}
    />
  )
}
