import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import ProductsClient from './ProductsClient'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const { getCurrentRole, canAccess } = await import('@/lib/getRole')
  const { redirect } = await import('next/navigation')
  const userRole = await getCurrentRole()
  if (!canAccess('products', userRole)) redirect('/orders')

  const supabase = createServiceClient()

  const allProducts = await fetchAllRows(() =>
    supabase
      .from('products')
      .select('id, name, description, sku, price, price_old, stock, status, images, external_id, category_name, categories, brand, attributes, unit, vendor')
      .order('name')
  )

  const warehouseName = process.env.WC_WAREHOUSE ?? 'Гуртівня онлайн'
  const readOnly = userRole === 'viewer'

  return (
    <ProductsClient
      allProducts={allProducts ?? []}
      warehouseName={warehouseName}
      readOnly={readOnly}
    />
  )
}
