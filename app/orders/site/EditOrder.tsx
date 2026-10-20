'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Overlay, { ProductPicker, field, money, type Line } from '@/components/OrderLinesPicker'
import { deliveryFeeFor } from '@/lib/delivery-fee'
import { SLOTS } from '@/lib/delivery-slots'

/**
 * Правка замовлення з сайту.
 *
 * Той самий підбір товарів, що й при прийомі телефоном — бо це та сама
 * робота: оператор говорить із клієнтом і міняє замовлення. Після збереження
 * угода в Бітріксі оновлюється, інакше склад збирав би стару версію.
 */
export default function EditOrder({ id, warehouses, onClose }: {
  id: string
  warehouses: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [lines, setLines] = useState<Line[]>([])
  const [address, setAddress] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [zone, setZone] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/orders/${id}/site`)
      const d = await r.json()
      if (d.error) { setError(d.error); setLoading(false); return }

      setTitle(`${d.order.external_id ?? ''} · ${d.order.customer_name ?? ''}`)
      setAddress(d.order.address ?? '')
      setWarehouse(d.order.warehouse ?? '')
      setDate(d.order.delivery_date ?? '')
      setSlot(d.order.delivery_slot ?? '')
      setZone(d.order.delivery_zone ?? null)

      interface Item {
        id: string; title: string; unit: string | null; unit_weight: number | null
        price_per_unit: number; ordered_qty: number
        ordered_pieces: number | null; order_unit: 'кг' | 'шт' | null
        product_id: string | null; bitrix_product_id: number | null
      }
      setLines((d.items as Item[]).map(i => ({
        key: i.id,
        product_id: i.product_id,
        bitrix_product_id: i.bitrix_product_id,
        title: i.title,
        unit: i.unit ?? 'шт',
        unit_weight: Number(i.unit_weight ?? 0),
        price_per_unit: Number(i.price_per_unit),
        qty: Number(i.ordered_qty),
        order_unit: i.order_unit,
        pieces: i.ordered_pieces,
      })))
      setLoading(false)
    })()
  }, [id])

  // Доставка перераховується на льоту: оператор міняє склад замовлення й має
  // бачити, що саме скаже клієнту
  const goods = lines.filter(l => l.title !== 'Доставка замовлення')
  const goodsSum = goods.reduce((s, l) => s + l.qty * l.price_per_unit, 0)
  const delivery = goods.length ? deliveryFeeFor(goods) : 0
  const total = goodsSum + delivery

  async function save() {
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/orders/${id}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address, warehouse: warehouse || null,
          delivery_date: date || null, delivery_slot: slot || null,
          lines: goods.map(({ key, ...l }) => l),   // eslint-disable-line @typescript-eslint/no-unused-vars
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не вдалося зберегти')
      if (d.number_note) {
        // Номер не переїхав — замовлення збережене, але людина має знати
        setError(`Збережено. Номер лишився старий: ${d.number_note}`)
        setSaving(false)
        router.refresh()
        return
      }
      if (d.crm_error) {
        setError(`Збережено, але в Бітрікс не пішло: ${d.crm_error}`)
        setSaving(false)
        return
      }
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold truncate">Правка замовлення</h2>
          <div className="text-zinc-500 text-xs truncate">{title}</div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl px-1">×</button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-zinc-500 text-sm">Завантажуємо…</div>
      ) : (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
          <div className="space-y-4">
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Адреса</label>
              <input value={address} onChange={e => setAddress(e.target.value)} className={field} />
              <div className="text-zinc-600 text-xs mt-1">
                {zone ? `зона ${zone}` : 'зону буде визначено після збереження'}
              </div>
            </div>

            <div>
              <label className="text-zinc-400 text-xs block mb-1">Склад замовлення</label>
              <select value={warehouse} onChange={e => setWarehouse(e.target.value)} className={field}>
                <option value="">— не визначено —</option>
                {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-zinc-400 text-xs block mb-1">Дата доставки</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
              </div>
              <div>
                <label className="text-zinc-400 text-xs block mb-1">Період</label>
                <select value={slot} onChange={e => setSlot(e.target.value)} className={field}>
                  <option value="">— не вказано —</option>
                  {SLOTS.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          <ProductPicker lines={lines} onChange={setLines} total={total} />
        </div>
      )}

      {error && (
        <div className="mx-5 mb-3 bg-red-950/50 border border-red-800 rounded-lg px-3 py-2
                        text-red-400 text-xs">{error}</div>
      )}

      <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between gap-3">
        <div className="text-zinc-400 text-sm">
          Сума: <span className="text-white font-semibold">{money(total)}</span>
          {delivery > 0 && (
            <span className="text-zinc-500"> (товари {money(goodsSum)} + доставка {money(delivery)})</span>
          )}
          {goods.length > 0 && delivery === 0 && (
            <span className="text-emerald-500"> · доставка безкоштовна</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm px-3 py-2">
            Скасувати
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || loading || !goods.length}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                       text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Зберігаємо…' : 'Зберегти'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
