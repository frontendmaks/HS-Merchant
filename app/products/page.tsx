import { redirect } from 'next/navigation'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { productPage, productFacets } from '@/lib/product-page'
import ProductsClient from './ProductsClient'

export const dynamic = 'force-dynamic'
export default async function ProductsPage() {
  const role = await getCurrentRole()
  if (!canAccess('products', role)) redirect('/orders')
  const [data, facets] = await Promise.all([productPage(), productFacets()])
  return <ProductsClient allProducts={data.products} initialCount={data.count}
    saleCategories={facets} warehouseName={process.env.WC_WAREHOUSE ?? 'Гуртівня онлайн'}
    readOnly={role === 'viewer'} />
}
