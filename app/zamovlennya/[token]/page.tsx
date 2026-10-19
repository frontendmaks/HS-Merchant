export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import PrintButton from './PrintButton'

/**
 * Бланк замовлення для складу.
 *
 * Відкривається за токеном, без входу в Мерчант: комірник не має акаунта, але
 * має отримати замовлення. Сторінка свідомо проста — її друкують або читають
 * із телефона, тож нічого, крім самого замовлення, на ній немає.
 */
export default async function OrderSheet({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) notFound()

  const service = createServiceClient()
  const { data: order } = await service
    .from('orders')
    .select(`id, external_id, manual_number, delivery_date, delivery_slot,
             warehouse, customer_name, customer_phone, address,
             total, weight, operator_comment, status, created_at`)
    .eq('share_token', token)
    .maybeSingle()

  if (!order) notFound()

  const { data: items } = await service
    .from('order_items')
    .select('position, title, unit, ordered_qty, price_per_unit, ordered_total')
    .eq('order_id', order.id)
    .order('position')

  const when = order.delivery_date
    ? new Date(order.delivery_date as string).toLocaleDateString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

  return (
    <div className="min-h-screen bg-white text-black p-6 sm:p-10 max-w-3xl mx-auto print:p-0">
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <h1 className="text-2xl font-bold">
            Замовлення № {order.manual_number ?? order.external_id}
          </h1>
          <div className="text-sm mt-1">
            Доставка: <strong>{when}</strong>, {order.delivery_slot ?? '—'}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{order.warehouse ?? 'Склад не визначено'}</div>
          <div className="text-zinc-600">{order.external_id}</div>
        </div>
      </div>

      <table className="w-full text-sm mt-4">
        <tbody>
          <tr><td className="py-1 pr-4 font-semibold w-28">ПІБ</td><td>{order.customer_name}</td></tr>
          <tr><td className="py-1 pr-4 font-semibold">Контакти</td><td>{order.customer_phone}</td></tr>
          <tr><td className="py-1 pr-4 font-semibold align-top">Адреса</td><td>{order.address}</td></tr>
        </tbody>
      </table>

      <h2 className="text-lg font-bold mt-6 mb-2">Перелік товару</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-black">
            <th className="text-left py-1.5 w-8">№</th>
            <th className="text-left py-1.5">Назва</th>
            <th className="text-right py-1.5 w-24">Кількість</th>
            <th className="text-right py-1.5 w-24">Ціна</th>
            <th className="text-right py-1.5 w-24">Сума</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((i, n) => (
            <tr key={i.position as number} className="border-b border-zinc-300">
              <td className="py-2">{n + 1}</td>
              <td className="py-2">{i.title}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {Number(i.ordered_qty)} {i.unit}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                {Number(i.price_per_unit)} ₴
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                {Number(i.ordered_total ?? 0)} ₴
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td colSpan={4} className="py-2 text-right">Разом</td>
            <td className="py-2 text-right whitespace-nowrap">
              {Number(order.total ?? 0)} ₴
            </td>
          </tr>
          {order.weight != null && (
            <tr>
              <td colSpan={4} className="py-1 text-right text-zinc-600">Орієнтовна вага</td>
              <td className="py-1 text-right text-zinc-600 whitespace-nowrap">
                {Number(order.weight)} кг
              </td>
            </tr>
          )}
        </tfoot>
      </table>

      {order.operator_comment && (
        <div className="mt-5 border border-zinc-400 rounded p-3 text-sm">
          <div className="font-semibold mb-1">Коментар</div>
          <div className="whitespace-pre-wrap">{order.operator_comment}</div>
        </div>
      )}

      <PrintButton />
    </div>
  )
}
