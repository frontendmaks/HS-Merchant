'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isPhoneComplete, phoneKey, withPhonePrefix, PHONE_PREFIX } from '@/lib/phone'
import { deliveryFeeFor, isDeliveryLine } from '@/lib/delivery-fee'
import ZonePicker, { type ZoneShape } from '@/components/ZonePicker'
import Overlay, { ProductPicker, field, money, type Line } from '@/components/OrderLinesPicker'
import Settings from './Settings'

interface Recent {
  id: string; external_id: string; manual_number: number | null
  delivery_date: string | null; delivery_slot: string | null; warehouse: string | null
  customer_name: string | null; customer_phone: string | null; address: string | null
  total: number | null; status: string | null; share_token: string | null
  created_at: string
}
interface SlotOption { label: string; available: boolean; reason: string | null }
interface Customer {
  key: string; phone: string; phones?: string[]; names: string[]; addresses: string[]
  orders: number; last: string | null
}


export default function ManualOrdersClient({
  recent, warehouses, initial, canSetChats, buffer, zones,
  marketplaceAuto, marketplaceWarehouse,
}: {
  recent: Recent[]
  warehouses: string[]
  initial: { date: string; slot: string; slots: SlotOption[] }
  canSetChats?: boolean
  buffer: number
  zones: ZoneShape[]
  marketplaceAuto?: boolean
  marketplaceWarehouse?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Ручні замовлення</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            Замовлення, прийняті телефоном. Потрапляють у загальний список разом із маркетплейсними.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                     px-4 py-2 rounded-lg transition-colors"
        >
          + Нове замовлення
        </button>
      </div>

      {canSetChats && (
        <Settings
          buffer={buffer}
          marketplace={marketplaceAuto}
          warehouses={warehouses}
          warehouse={marketplaceWarehouse}
        />
      )}

      {recent.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center">
          <div className="text-white text-sm font-medium">Ще немає жодного ручного замовлення</div>
          <p className="text-zinc-500 text-xs mt-2 max-w-md mx-auto leading-relaxed">
            Натисніть «Нове замовлення» — форма підкаже склад за адресою й доступні періоди доставки.
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
          {recent.map(o => (
            <div key={o.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="w-10 text-center text-white text-sm font-semibold tabular-nums">
                {o.manual_number ?? '—'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm">{o.customer_name}</div>
                <div className="text-zinc-500 text-xs mt-0.5 truncate">
                  {o.customer_phone} · {o.address}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-zinc-300 text-xs">
                  {o.delivery_date} · {o.delivery_slot}
                </div>
                <div className="text-zinc-500 text-xs">{o.warehouse ?? 'склад не визначено'}</div>
              </div>
              <span className="text-white text-sm tabular-nums w-24 text-right shrink-0">
                {money(Number(o.total ?? 0))}
              </span>
              {o.share_token && (
                <a
                  href={`/zamovlennya/${o.share_token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 text-xs shrink-0 transition-colors"
                >
                  бланк →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <NewOrder
          warehouses={warehouses}
          zones={zones}
          initial={initial}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}

/**
 * Форма прийому замовлення.
 *
 * Порядок полів повторює паперовий бланк — ПІБ, контакти, адреса, товари, —
 * бо операторка заповнює його під час розмови й читає з того самого місця,
 * що й раніше. Склад і період стоять після адреси, бо саме вона їх визначає.
 */
function NewOrder({ warehouses, zones, initial, onClose, onCreated }: {
  warehouses: string[]
  zones: ZoneShape[]
  initial: { date: string; slot: string; slots: SlotOption[] }
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState(PHONE_PREFIX)
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')

  const [warehouse, setWarehouse] = useState<string>('')
  const [zone, setZone] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [zoneNote, setZoneNote] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const [date, setDate] = useState(initial.date)
  const [slot, setSlot] = useState(initial.slot)
  const [slots, setSlots] = useState<SlotOption[]>(initial.slots)

  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{
    number: number
    source?: string
    note?: string | null
    deal_id?: number | null
    crm_error?: string | null
  } | null>(null)

  /*
   * Клієнта впізнає тільки номер.
   *
   * Шукало й по імені, і по адресі — і це коштувало дорого: набране зі
   * слуху «Коваленко» підставляло картку чужого Коваленка разом із його
   * адресою, а оператор цього не бачив, бо поля заповнились самі.
   *
   * Номер телефону такого не припускає: він або той самий, або інший.
   * Не знайшли за номером — отже, клієнт новий, і його заводять із нуля.
   */
  const [byPhone, setByPhone] = useState<Customer[]>([])
  const [picked, setPicked] = useState<Customer | null>(null)

  /** Підказка з'являється з четвертої цифри номера — раніше шукати нічого */
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (phoneTimer.current) clearTimeout(phoneTimer.current)
    // «+38» саме по собі — ще не пошук: інакше підказки падають на порожнє поле
    if (phone.replace(/\D/g, '').length < 4 || picked?.phone === phone) {
      setByPhone([]); return
    }
    phoneTimer.current = setTimeout(async () => {
      const r = await fetch(
        `/api/orders/manual/customers?by=phone&q=${encodeURIComponent(phone)}`)
      const d = await r.json().catch(() => ({}))
      setByPhone(d.customers ?? [])
    }, 120)
  }, [phone, picked])

  /**
   * Номер повний, а клієнта за ним немає — значить, новий.
   *
   * Чекаємо саме повного номера: на половині набраного «не знайшли» нічого
   * не означає.
   */
  const isNewCustomer = isPhoneComplete(phone) && !picked && byPhone.length === 0

  /** Що саме підставила база — щоб відрізнити це від набраного руками. */
  const [filled, setFilled] = useState<{ name: string; address: string } | null>(null)

  /**
   * Обраний клієнт заповнює решту полів — це і є сенс бази клієнтів.
   *
   * Адресу часто доводиться дозапитувати: більшість клієнтів прийшла з
   * контактів CRM, де адреси немає, — вона лежить в їхніх угодах.
   */
  function pick(c: Customer) {
    const pickedName = c.names[0] ?? ''
    const pickedAddress = c.addresses[0] ?? ''
    setPicked(c)
    setPhone(withPhonePrefix(c.phone))
    if (pickedName) setName(pickedName)
    if (pickedAddress) setAddress(pickedAddress)
    setFilled({ name: pickedName, address: pickedAddress })
    setByPhone([])

    if (pickedAddress) return
    void (async () => {
      const r = await fetch(`/api/orders/manual/customers/${encodeURIComponent(c.key)}`)
      const d = await r.json().catch(() => ({}))
      const found = (d.addresses as string[] | undefined)?.[0]
      if (!found) return
      // Підставляємо, лише якщо оператор ще не почав писати адресу сам
      setAddress(prev => (prev ? prev : found))
      setFilled(f => (f ? { ...f, address: found } : f))
      setPicked(p => (p && p.key === c.key ? { ...p, addresses: d.addresses } : p))
    })()
  }

  /**
   * Інший номер — інший клієнт.
   *
   * Поки поля лишались від попереднього, на екрані стояло замовлення на двох:
   * номер одного, ім'я й адреса другого. Тому підставлене базою прибираємо, а
   * набране руками лишаємо — оператор міг записати ім'я зі слуху й аж потім
   * уточнити номер.
   */
  function changePhone(raw: string) {
    // Код країни лишається на місці, хоч би що стерли чи вставили
    const next = withPhonePrefix(raw)
    setPhone(next)
    if (!picked || phoneKey(next) === picked.key) return

    if (filled) {
      if (name === filled.name) setName('')
      if (address === filled.address) {
        setAddress('')
        // Склад випливав із тієї адреси — разом із нею й зникає
        setWarehouse(''); setZone(null); setZoneNote(null)
      }
    }
    setPicked(null)
    setFilled(null)
  }

  /** Адреса → склад і періоди. Запитуємо, коли оператор дописав адресу. */
  const resolve = useCallback(async (addr: string, when: string) => {
    if (addr.trim().length < 5) return
    setResolving(true)
    try {
      const r = await fetch('/api/orders/manual/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, date: when }),
      })
      const d = await r.json()
      setSlots(d.slots ?? [])
      setZone(d.zone ?? null)
      setZoneNote(d.note ?? null)
      setCoords(d.coordinates ?? null)
      if (d.warehouse) setWarehouse(d.warehouse)
      // Якщо обраний період закрився, пересуваємось на перший доступний
      const free = (d.slots ?? []).find((s: SlotOption) => s.available)
      if (free && !(d.slots ?? []).find((s: SlotOption) => s.label === slot && s.available)) {
        setSlot(free.label)
      }
    } finally {
      setResolving(false)
    }
  }, [slot])

  const addrTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (addrTimer.current) clearTimeout(addrTimer.current)
    addrTimer.current = setTimeout(() => void resolve(address, date), 700)
  }, [address, date, resolve])

  /*
   * Оператор називає клієнту суму вголос, тож доставку він має бачити
   * тут, а не дізнаватись про неї з готового замовлення.
   *
   * І бачити саме ту, що буде в замовленні: якщо він вписав рядок
   * доставки сам — далеке село, домовлена сума, — рахуємо його, а не
   * поріг. Інакше на екрані одне число, а в бланку інше.
   */
  const goods = lines.filter(l => !isDeliveryLine(l))
  const goodsSum = goods.reduce((s, l) => s + l.qty * l.price_per_unit, 0)
  const typedDelivery = lines
    .filter(isDeliveryLine)
    .reduce((s, l) => s + l.qty * l.price_per_unit, 0)

  const delivery = lines.some(isDeliveryLine)
    ? typedDelivery
    : (goods.length ? deliveryFeeFor(goods) : 0)
  const total = goodsSum + delivery

  /**
   * Чого бракує, щоб замовлення можна було прийняти.
   *
   * Усе, крім коментаря, обовʼязкове: половина бланка — це замовлення, яке
   * комірник не збере, а кур'єр не відвезе. Показуємо переліком, а не одним
   * «заповніть поля», щоб не шукати очима, де саме порожньо.
   */
  const missing: string[] = []
  if (!isPhoneComplete(phone)) missing.push('телефон')
  if (name.trim().length < 2) missing.push('ПІБ')
  if (address.trim().length < 5) missing.push('адресу')
  if (!warehouse) missing.push('склад')
  if (!date) missing.push('дату')
  if (!slots.some(x => x.label === slot && x.available)) missing.push('період доставки')
  if (!lines.length) missing.push('товари')
  else {
    /*
     * Кажемо, у якому саме рядку порожньо.
     *
     * «Бракує: кількість і ціну в кожному рядку» під списком на десять
     * позицій не каже нічого: оператор перечитує всі десять, шукаючи
     * очима нуль. Найчастіше це один вписаний руками рядок, якому не
     * назвали ціну.
     */
    const gaps = lines
      .map((l, n) => {
        const what = [
          l.qty <= 0 ? 'кількість' : null,
          l.price_per_unit <= 0 ? 'ціну' : null,
        ].filter(Boolean)
        return what.length ? `${what.join(' і ')} в рядку ${n + 1}` : null
      })
      .filter((x): x is string => !!x)

    missing.push(...gaps)
  }


  async function submit() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/orders/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: name, customer_phone: phone, address,
          warehouse: warehouse || null, delivery_zone: zone,
          delivery_date: date, delivery_slot: slot,
          comment: comment || null,
          lines: lines.map(({ key, ...l }) => l),   // eslint-disable-line @typescript-eslint/no-unused-vars
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Не вдалося створити')
      setDone({
        number: d.number,
        source: d.number_source, note: d.number_note,
        deal_id: d.deal_id ?? null, crm_error: d.crm_error ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <Overlay onClose={onCreated}>
        <div className="p-6 text-center">
          <div className="text-emerald-400 text-sm">✓ Замовлення прийнято</div>
          <div className="text-white text-3xl font-bold mt-2">№ {done.number}</div>
          <p className="text-zinc-400 text-xs mt-3">
            {done.source === 'sheet'
              ? 'Номер узято з журналу, ім’я клієнта вписано в таблицю.'
              : 'Номер видав Мерчант — у журнал він не потрапив.'}
          </p>
          {done.note && (
            <div className="mt-2 bg-amber-950/40 border border-amber-900 rounded-lg
                            px-3 py-2 text-amber-400 text-xs">
              {done.note} — впишіть номер у журнал вручну
            </div>
          )}
          {done.deal_id ? (
            <div className="mt-3 text-zinc-400 text-xs">
              Угода в Бітріксі — <span className="text-white">#{done.deal_id}</span>
            </div>
          ) : (
            <div className="mt-3 bg-amber-950/40 border border-amber-900 rounded-lg
                            px-3 py-2 text-amber-400 text-xs">
              У Бітрікс не потрапило{done.crm_error ? `: ${done.crm_error}` : ''}.
              Замовлення прийняте — передайте його в CRM вручну.
            </div>
          )}
          {/* Бланк піде, коли замовлення переведуть на комплектацію —
              так само, як у сайтових. Доти воно чекає огляду */}
          <div className="mt-2 text-zinc-400 text-xs">
            Чекає огляду. Бланк піде в чат складу, коли замовлення
            переведуть на «Комплектується».
          </div>
          <button onClick={onCreated}
            className="mt-5 bg-red-600 hover:bg-red-500 text-white text-sm px-4 py-2 rounded-lg">
            Готово
          </button>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay onClose={onClose}>
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-white font-semibold">Нове замовлення</h2>
        <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl px-1">×</button>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        <div className="space-y-4">
          {/* Телефон — головний ідентифікатор клієнта */}
          <div className="relative">
            <label className="text-zinc-400 text-xs block mb-1">
              Телефон <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={phone}
              onChange={e => changePhone(e.target.value)}
              placeholder="+380671234567"
              className={field}
            />
            {byPhone.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700
                              rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                {byPhone.map(c => (
                  <button key={c.key} onClick={() => pick(c)}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-700 transition-colors">
                    <div className="text-white text-sm">{c.phone}</div>
                    <div className="text-zinc-500 text-xs">
                      {c.names[0] ?? 'без імені'} · замовлень: {c.orders}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/*
              * Не знайшли за номером — отже, клієнт новий.
              *
              * Сказати це вголос варто: оператор інакше не певен, чи то
              * база мовчить, чи то він помилився цифрою. А ще це обіцянка
              * — контакт заведеться в Бітріксі сам, і вписувати його туди
              * руками не треба.
              */}
            {isNewCustomer && (
              <div className="text-amber-500 text-xs mt-1.5">
                Новий клієнт — заведемо його в Бітріксі під час оформлення
              </div>
            )}
          </div>

          <div className="relative">
            <label className="text-zinc-400 text-xs block mb-1">
              ПІБ клієнта <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setPicked(null) }}
              placeholder="Прізвище та ім'я"
              className={field}
            />
            {picked && picked.names.length > 1 && (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {picked.names.slice(0, 4).map(n => (
                  <button key={n} onClick={() => setName(n)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${
                      name === n ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <label className="text-zinc-400 text-xs block mb-1">
              Адреса <span className="text-red-500">*</span>
            </label>
            <input value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Львів, вул. Городоцька, 120, кв. 5" className={field} />
            {picked && picked.addresses.length > 1 && (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {picked.addresses.slice(0, 4).map(a => (
                  <button key={a} onClick={() => setAddress(a)}
                    className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400 hover:text-white
                               transition-colors max-w-[240px] truncate">
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Склад — випливає з адреси, але лишається виправним */}
          <div>
            <label className="text-zinc-400 text-xs block mb-1">
              Склад замовлення <span className="text-red-500">*</span>
              {resolving && <span className="text-zinc-600"> · визначаємо…</span>}
              {zone && !resolving && <span className="text-emerald-500"> · за адресою ({zone})</span>}
            </label>
            <select value={warehouse} onChange={e => setWarehouse(e.target.value)} className={field}>
              <option value="">— оберіть склад —</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            {zoneNote && <div className="text-amber-400 text-xs mt-1">{zoneNote}</div>}

            {/* Склад не визначився сам — показуємо карту: вулицю на ній
                видно краще, ніж її назву в довіднику */}
            {zoneNote && address.trim().length > 4 && (
              <div className="mt-2">
                <ZonePicker
                  point={coords}
                  zones={zones}
                  warehouse={warehouse}
                  onPick={(w, z) => { setWarehouse(w); setZone(z); setZoneNote(null) }}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-400 text-xs block mb-1">
                Дата доставки <span className="text-red-500">*</span>
              </label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">
                Період <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col gap-1">
                {slots.map(s => (
                  <button
                    key={s.label}
                    disabled={!s.available}
                    onClick={() => setSlot(s.label)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                      slot === s.label && s.available ? 'bg-red-600 text-white'
                        : s.available ? 'bg-zinc-800 text-zinc-300 hover:text-white'
                        : 'bg-zinc-800/40 text-zinc-600 cursor-default'
                    }`}
                  >
                    {s.label}
                    {!s.available && s.reason && (
                      <span className="text-zinc-600"> — {s.reason}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-zinc-400 text-xs block mb-1">Коментар (необовʼязково)</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
              placeholder="Подзвонити перед виїздом" className={field} />
          </div>
        </div>

        <ProductPicker lines={lines} onChange={setLines} total={total} />
      </div>

      {error && (
        <div className="mx-5 mb-3 bg-red-950/50 border border-red-800 rounded-lg px-3 py-2
                        text-red-400 text-xs">{error}</div>
      )}

      <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between gap-3">
        <div className="text-zinc-400 text-sm min-w-0">
          Позицій: <span className="text-white">{lines.length}</span>
          <span className="mx-2 text-zinc-700">·</span>
          Сума: <span className="text-white font-semibold">{money(total)}</span>
          {delivery > 0 && (
            <span className="text-zinc-500">
              {' '}(товари {money(goodsSum)} + доставка {money(delivery)})
            </span>
          )}
          {lines.length > 0 && delivery === 0 && (
            <span className="text-emerald-500"> · доставка безкоштовна</span>
          )}
          {missing.length > 0 && (
            <div className="text-amber-500 text-xs mt-0.5">
              Бракує: {missing.join(', ')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm px-3 py-2">
            Скасувати
          </button>
          <button
            disabled={saving || missing.length > 0}
            onClick={submit}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                       text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Приймаємо…' : 'Прийняти замовлення'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

