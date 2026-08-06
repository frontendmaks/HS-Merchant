import { createServiceClient } from '@/lib/supabase/service'
import ProductsClient from './ProductsClient'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const { getCurrentRole } = await import('@/lib/getRole')
  const { redirect } = await import('next/navigation')
  const userRole = await getCurrentRole()
  if (userRole === 'operator') redirect('/orders')

  const supabase = createServiceClient()

  const { data: allProducts } = await supabase
    .from('products')
    .select('id, name, description, sku, price, price_old, stock, status, images, external_id, category_name, categories, brand, attributes, unit, vendor')
    .order('name')

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
