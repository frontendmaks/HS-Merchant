import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import ReviewForm from './ReviewForm'

export const dynamic = 'force-dynamic'

/**
 * Відгук клієнта.
 *
 * Сторінка відкрита за тим самим токеном, що й бланк: це те саме
 * замовлення, і другий секрет означав би вдвічі більше шансів його
 * загубити. Нічого внутрішнього тут немає — ні номера ящика, ні складу.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) notFound()

  const service = createServiceClient()
  const { data: order } = await service
    .from('orders')
    .select('id, customer_name, delivery_date')
    .eq('share_token', token).maybeSingle()

  if (!order) notFound()

  const { data: existing } = await service
    .from('order_reviews')
    .select('rating, comment').eq('order_id', order.id).maybeSingle()

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-bold">Як пройшла доставка?</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Галицька Свіжина — дякуємо, що замовляєте в нас
        </p>

        <ReviewForm
          token={token}
          rating={existing?.rating as number | undefined}
          comment={(existing?.comment as string | null) ?? ''}
        />
      </div>
    </div>
  )
}
