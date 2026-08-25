import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { notFound } from 'next/navigation'
import FeedEditor from './FeedEditor'

export const dynamic = 'force-dynamic'

export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const [{ data: feed }, feedProducts, allProducts, { data: marketplaces }] = await Promise.all([
    supabase.from('feeds').select('*, marketplace:marketplaces(id, name, slug)').eq('id', id).single(),
    fetchAllRows(() => supabase.from('feed_products').select('*').eq('feed_id', id)),
    fetchAllRows(() =>
      supabase
        .from('products')
        .select('id, name, description, category_name, categories, brand, price, price_old, stock, images, attributes')
        .eq('status', 'active')
        .order('name')
    ),
    supabase.from('marketplaces').select('id, name'),
  ])

  if (!feed) notFound()

  const categories = [...new Set((allProducts ?? []).map(p => p.category_name).filter(Boolean))] as string[]

  return (
    <FeedEditor
      feed={feed}
      feedProducts={feedProducts ?? []}
      allProducts={allProducts ?? []}
      categories={categories.sort()}
      marketplaces={marketplaces ?? []}
    />
  )
}
