import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { notFound } from 'next/navigation'
import FeedEditor from './FeedEditor'

export const dynamic = 'force-dynamic'

const PRODUCT_FIELDS =
  'id, name, description, category_name, categories, brand, price, price_old, stock, images, attributes, status'

export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const [{ data: feed }, feedProducts, allProducts, { data: marketplaces }] = await Promise.all([
    supabase.from('feeds').select('*, marketplace:marketplaces(id, name, slug)').eq('id', id).single(),
    fetchAllRows(() => supabase.from('feed_products').select('*').eq('feed_id', id)),
    fetchAllRows(() =>
      supabase
        .from('products')
        .select(PRODUCT_FIELDS)
        .eq('status', 'active')
        .order('name')
    ),
    supabase.from('marketplaces').select('id, name'),
  ])

  if (!feed) notFound()

  // Products retired from the site still belong to the feed — their offers go
  // out marked out of stock rather than vanishing, which would retire the card
  // on the marketplace. Listing only active products hid them from the person
  // running the feed, so a product simply disappeared from the editor with no
  // way to see what became of it.
  const listed = new Set((allProducts ?? []).map(p => p.id as string))
  const missing = feedProducts
    .map(fp => fp.product_id as string)
    .filter(id => !listed.has(id))

  const retired = missing.length
    ? (await supabase.from('products').select(PRODUCT_FIELDS).in('id', missing)).data ?? []
    : []

  const products = [...(allProducts ?? []), ...retired]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'uk'))

  const categories = [...new Set(products.map(p => p.category_name).filter(Boolean))] as string[]

  return (
    <FeedEditor
      feed={feed}
      feedProducts={feedProducts ?? []}
      allProducts={products}
      categories={categories.sort()}
      marketplaces={marketplaces ?? []}
    />
  )
}
