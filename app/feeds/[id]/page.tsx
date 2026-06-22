import { createServiceClient } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'
import FeedEditor from './FeedEditor'

export const dynamic = 'force-dynamic'

export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const [{ data: feed }, { data: feedProducts }, { data: allProducts }, { data: marketplaces }] = await Promise.all([
    supabase.from('feeds').select('*, marketplace:marketplaces(id, name, slug)').eq('id', id).single(),
    supabase.from('feed_products').select('*').eq('feed_id', id),
    supabase.from('products').select('id, name, category_name, brand, price, stock, images').eq('status', 'active').order('name'),
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
