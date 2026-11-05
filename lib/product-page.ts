import { createServiceClient } from '@/lib/supabase/service'
import { unstable_cache } from 'next/cache'

export async function productPage(filters: Record<string, unknown> = {}) {
  const { data, error } = await createServiceClient().rpc('merchant_product_page', { p_filters: filters })
  if (error) throw error
  return data
}
export const productFacets = unstable_cache(async () => {
  const { data, error } = await createServiceClient().rpc('merchant_product_facets')
  if (error) throw error
  return data as string[]
}, ['product-facets-v1'], { revalidate: 300 })
