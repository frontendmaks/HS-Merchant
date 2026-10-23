export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { dealUrl } from '@/lib/bitrix-portal'
import { getCurrentRole } from '@/lib/getRole'
import { isInProgress } from '@/lib/order-statuses'
import { SITE_PLATFORMS, platformLabel } from '@/lib/order-source'
import StatusSelect from '../StatusSelect'
import WideScroll from '../WideScroll'
import SyncButton from './SyncButton'
import SiteFilters from './SiteFilters'
import { lastCronRun } from '@/lib/cron-log'
import EditButton from './EditButton'
import MergePreorders from './MergePreorders'
import DeleteButton from './DeleteButton'

/**
 * Замовлення з сайту й телефону.
 *
 * Тут важливе інше, ніж на маркетплейсах: не ТТН і комісія, а куди й коли
 * везти — склад, дата, період. Звідси й колонки, і бланк для комірника
 * поруч із кожним рядком.
 */

const UA_MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']

function shortDate(date: string | null) {
  if (!date) return '—'
  const [, m, d] = date.split('-')
  return `${Number(d)} ${UA_MONTHS[Number(m) - 1] ?? ''}`
}

const money = (n: number | null) =>
  (n ?? 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴'

interface Row {
  id: string; external_id: string | null; manual_number: number | null
  number_source: string | null; platform: string | null; customer_name: string | null
  customer_phone: string | null; address: string | null; warehouse: string | null
  delivery_zone: string | null; delivery_date: string | null; delivery_slot: string | null
  total: number | null; status: string | null; share_token: string | null
  auto_done_at: string | null; auto_problem: string | null; chat_sent_at: string | null
  bitrix_deal_id: number | null; bitrix_error: string | null
  customer_comment: string | null
  /** Оцінка клієнта, якщо він її лишив */
  review?: { rating: number; comment: string | null }[] | null
}

/**
 * Воронка опрацювання.
 *
 * Не те саме, що стадії Бітрікса: там стадія каже, де замовлення в житті, а
 * тут — що з ним має зробити оператор. «Нове» це те, чого система ще не
 * оглянула; «Перевірено» — оглянуте без хиб, із номером ящика й бланком.
 */
const PREORDER = 'ПЕРЕДЗАМОВЛЕННЯ'
const PICKING = 'Комплектується'
/** Спаковано — та сама робота складу, лише на крок далі */
const PACKED = 'Спаковано'
const PROCESSING = 'В обробці'
const CANCELED = 'Скасовано'
/** Виконано — день закінчився, замовлення поїхало */
const DONE = 'Виконано'

/**
 * Етапи опрацювання — те, що оператор має зробити далі.
 *
 * Не стадії Бітрікса: там стадія каже, де замовлення в житті. Тут кожен
 * етап — питання «чи зроблено з ним те, що мало бути зроблено», і
 * замовлення стоїть рівно в одному з них.
 *
 * «Нове» — щойно приїхало й ще не оглянуте.
 * «Перевірено» — оглянуте без хиб: номер ящика є, зона й поля на місці.
 *   Чекає, поки його відправлять на комплектацію.
 * «Потребує уваги» — оглянуте, але чогось бракує; що саме, написано в рядку.
 * «Комплектується» — переведене й бланк уже в чаті складу.
 * «Виконані» — день закрито. Проставляється щоночі, але перевести можна
 *   й раніше руками, якщо замовлення вже доїхало.
 */
const FUNNEL: { key: string; label: string; match: (o: Row) => boolean }[] = [
  {
    key: 'new', label: 'Нові',
    match: o => o.status === PROCESSING && !o.auto_done_at,
  },
  {
    key: 'checked', label: 'Перевірено',
    match: o => o.status === PROCESSING && !!o.auto_done_at && !o.auto_problem
      && o.manual_number != null,
  },
  {
    /**
     * Хиба важить, лише поки замовлення ще в обробці.
     *
     * Щойно людина перевела його далі — вона подивилась на нього сама й
     * вирішила, що воно готове. Наші зауваження після цього вже не про те
     * замовлення, яке поїхало.
     */
    key: 'problem', label: 'Потребує уваги',
    match: o => !!o.auto_problem && (o.status === PROCESSING || o.status === PREORDER),
  },
  { key: 'preorder', label: 'Передзамовлення', match: o => o.status === PREORDER },
  {
    key: 'picking', label: 'Комплектується',
    match: o => o.status === PICKING || o.status === PACKED,
  },
  { key: 'done', label: 'Виконані', match: o => o.status === DONE },
  { key: 'canceled', label: 'Скасовано', match: o => o.status === CANCELED },
  { key: 'all', label: 'Усі', match: () => true },
]

export default async function SiteOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string; stage?: string
    wh?: string; slot?: string; src?: string; q?: string; period?: string
  }>
}) {
  const role = await getCurrentRole()
  const readOnly = role === 'viewer'
  const {
    date: dateParam, stage = 'new', wh = '', slot = '', src = '', q = '', period = '',
  } = await searchParams

  // За замовчуванням — сьогодні: саме сьогоднішні замовлення возять
  const date = dateParam || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

  /*
   * День чи місяць.
   *
   * День лишається тим, що відкривається саме: возять сьогоднішнє. Але
   * клієнт телефонує не «по вівторку», а «ви мені возили» — і шукати його
   * в одному дні означає не знайти. Тому пошук сам розширює огляд на
   * місяць: порожній результат у межах дня брехав би, що замовлення немає.
   */
  /*
   * Горизонт черги огляду — від сьогоднішньої київської дати.
   *
   * Рахуємо з дати, а не з «тридцяти шести годин тому»: друге — звичайний
   * виклик годинника посеред рендера, і React справедливо вважає це
   * нечистим. Доба з половиною назад від сьогодні — це позавчора.
   */
  const horizon = (() => {
    const d = new Date(`${date}T12:00:00`)
    d.setDate(d.getDate() - 2)
    return d.toLocaleDateString('en-CA')
  })()

  const monthly = period === 'month' || q.trim().length > 0
  const monthStart = `${date.slice(0, 7)}-01`
  const monthEnd = (() => {
    const d = new Date(`${monthStart}T12:00:00`)
    d.setMonth(d.getMonth() + 1)
    d.setDate(0)
    return d.toLocaleDateString('en-CA')
  })()

  const supabase = createServiceClient()

  const COLUMNS = 'id, external_id, manual_number, number_source, platform, order_date, customer_name, customer_phone, address, warehouse, delivery_zone, delivery_date, delivery_slot, total, status, share_token, auto_done_at, auto_problem, chat_sent_at, bitrix_deal_id, bitrix_error, customer_comment, review:order_reviews(rating, comment)'

  const pager = <T,>(q: unknown) => q as unknown as {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  }

  /*
   * Усе, що не залежить одне від одного, — одним заходом.
   *
   * Запитів тут сім, і раніше вони йшли низкою: кожен чекав на
   * попередній, хоч жодному з них попередній не потрібен. Перемикання
   * фільтра коштувало семи подорожей до бази поспіль — і саме це було
   * видно як затримку.
   */
  const [lastSync, queuedRes, nowCheckingRes, zonesRes, dated, undated] = await Promise.all([
    lastCronRun(supabase, 'bitrix-sync'),

    supabase.from('orders')
      .select('id', { count: 'exact', head: true })
      .in('platform', [...SITE_PLATFORMS]).is('auto_done_at', null)
      // Той самий горизонт, що й в огляду: старе в черзі не рахуємо
      .gte('delivery_date', horizon)
      .not('status', 'in', '("Виконано","Скасовано","Повернено","Не вдалося")'),

    supabase.from('app_settings').select('value').eq('key', 'autopilot_now').maybeSingle(),

    supabase.from('delivery_zones').select('warehouse'),

    /*
     * День читаємо одним запитом, місяць — сторінками.
     *
     * PostgREST віддає щонайбільше тисячу рядків і мовчки обрізає решту,
     * тож місяць без сторінок був би неповним. Але в дні замовлень
     * десятки, і ганяти заради них чотири паралельні запити — це платити
     * за місяць щоразу, коли дивишся день.
     */
    monthly
      ? fetchAllRows<Row>(() => pager<Row>(
          supabase.from('orders').select(COLUMNS)
            .in('platform', [...SITE_PLATFORMS])
            .gte('delivery_date', monthStart).lte('delivery_date', monthEnd)
            .order('delivery_date', { ascending: false })
            .order('created_at', { ascending: false })), 1000, 2)
      : supabase.from('orders').select(COLUMNS)
          .in('platform', [...SITE_PLATFORMS])
          .eq('delivery_date', date)
          .order('created_at', { ascending: false })
          .limit(1000)
          .then(r => (r.data ?? []) as unknown as Row[]),

    /*
     * Замовлення без дати доставки теж мають бути видимі.
     *
     * Поки дата порожня, замовлення не належить жодному дню — і в списку
     * по днях його немає взагалі. Саме так півсотні замовлень пролежали
     * непоміченими: вони були в базі, але питати про них було нічим. За
     * місяць беремо їх за днем створення, бо іншої дати в них немає.
     */
    monthly
      ? supabase.from('orders').select(COLUMNS)
          .in('platform', [...SITE_PLATFORMS])
          .is('delivery_date', null)
          .gte('order_date', monthStart).lte('order_date', monthEnd)
          .order('order_date', { ascending: false })
          .limit(1000)
          .then(r => (r.data ?? []) as unknown as Row[])
      : Promise.resolve([] as Row[]),
  ])

  const queued = queuedRes.count
  const nowChecking = nowCheckingRes.data
  const warehouses = [...new Set((zonesRes.data ?? []).map(z => z.warehouse as string))].sort()

  const inScope = [...dated, ...undated]

  /*
   * Зріз дня: склад, період, джерело, пошук.
   *
   * Лічильники на вкладках рахуються вже по зрізу, а не по всьому дню.
   * Інакше вийшло б, що обрано «Панська Гора», а на вкладці стоїть
   * тридцять — і незрозуміло, тридцять чого.
   */
  const needle = q.trim().toLowerCase()
  const scoped = inScope.filter(o =>
    (!wh || o.warehouse === wh)
    && (!slot || o.delivery_slot === slot)
    && (!src || o.platform === src)
    && (!needle || [o.customer_name, o.customer_phone, o.address, o.external_id,
      o.bitrix_deal_id != null ? String(o.bitrix_deal_id) : null,
      o.manual_number != null ? `№${o.manual_number}` : null]
      .some(v => (v ?? '').toLowerCase().includes(needle))))

  const tabs = FUNNEL.map(f => ({
    key: f.key, label: f.label, count: scoped.filter(f.match).length,
  }))

  const matcher = FUNNEL.find(f => f.key === stage) ?? FUNNEL[0]
  const orders = scoped.filter(matcher.match)

  /*
   * Що можна звести в одне замовлення.
   *
   * Беремо передзамовлення з того, що зараз у списку: об'єднання має
   * стосуватись того, на що людина дивиться, а не всього місяця.
   */
  const mergeable = orders.filter(o => o.status === PREORDER)
  const active = scoped.filter(o => isInProgress(o.status))

  // Пропонуємо лише те, що цього дня справді є: порожній варіант у списку
  // обіцяє замовлення, яких немає
  const slotsToday = [...new Set(inScope.map(o => o.delivery_slot).filter(Boolean))].sort() as string[]
  const warehousesToday = [...new Set(inScope.map(o => o.warehouse).filter(Boolean))].sort() as string[]

  /*
   * Підсумок зрізу — по тому, що видно.
   *
   * Рахуємо не весь місяць, а відфільтроване: якщо обрано склад, число
   * має відповідати тому, що під ним у таблиці. Скасовані в суму не
   * йдуть — грошей за ними немає.
   */
  /*
   * Розбіжності, які видно лише поруч.
   *
   * Одне замовлення про себе нічого дивного не каже: номер як номер,
   * сума як сума. Але два замовлення одного дня під одним номером — це
   * два ящики, які на складі не розрізнити, а той самий телефон на ту
   * саму дату — це найчастіше одне замовлення, заведене двічі.
   */
  const byNumber = new Map<string, number>()
  const byPerson = new Map<string, number>()
  for (const o of inScope) {
    if (o.status === 'Скасовано') continue
    if (o.manual_number != null && o.delivery_date) {
      const key = `${o.delivery_date}|${o.manual_number}`
      byNumber.set(key, (byNumber.get(key) ?? 0) + 1)
    }
    const phone = (o.customer_phone ?? '').replace(/\D/g, '').slice(-9)
    if (phone && o.delivery_date) {
      const key = `${o.delivery_date}|${phone}`
      byPerson.set(key, (byPerson.get(key) ?? 0) + 1)
    }
  }

  const sharesNumber = (o: Row) =>
    o.status !== 'Скасовано' && o.manual_number != null && o.delivery_date
    && (byNumber.get(`${o.delivery_date}|${o.manual_number}`) ?? 0) > 1

  const sharesPerson = (o: Row) => {
    const phone = (o.customer_phone ?? '').replace(/\D/g, '').slice(-9)
    return o.status !== 'Скасовано' && !!phone && !!o.delivery_date
      && (byPerson.get(`${o.delivery_date}|${phone}`) ?? 0) > 1
  }

  const live = scoped.filter(o => o.status !== 'Скасовано')
  const summary = {
    orders: scoped.length,
    sum: live.reduce((acc, o) => acc + Number(o.total ?? 0), 0),
    done: scoped.filter(o => o.status === 'Виконано').length,
    canceled: scoped.length - live.length,
    days: new Set(scoped.map(o => o.delivery_date)).size,
  }
  /*
   * Середній чек рахуємо лише по тому, у чому є гроші.
   *
   * Частина угод приходить із 1С зовсім без позицій і з сумою 0 ₴ — це
   * не безкоштовні замовлення, а дані, яких ще немає. У середньому вони
   * тягнуть його вниз і кажуть неправду про день.
   */
  const paid = live.filter(o => Number(o.total ?? 0) > 0)
  const avg = paid.length ? summary.sum / paid.length : 0
  const monthLabel = new Date(`${monthStart}T12:00:00`)
    .toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Замовлення (Сайт)</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            Сайт і телефон — склад, період доставки, бланк для комірника
          </p>
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <SyncButton
            last={lastSync?.ran_at ?? null}
            queued={queued ?? 0}
            checking={(nowChecking?.value as { external_id?: string; customer?: string; at?: string } | null) ?? null}
          />
          <Link
            href={`/orders/numbers?date=${date}`}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm inline-flex
                       items-center px-3 h-11 lg:h-auto lg:py-2 rounded-lg transition-colors"
          >
            Номери
          </Link>
          <Link
            href="/orders/manual"
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium inline-flex
                       items-center px-4 h-11 lg:h-auto lg:py-2 rounded-lg transition-colors"
          >
            + Нове замовлення
          </Link>
        </div>
      </div>

      <SiteFilters
        date={date}
        stage={matcher.key}
        tabs={tabs}
        warehouses={warehousesToday}
        slots={slotsToday}
        picked={{ wh, slot, src, q }}
        total={inScope.length}
        monthly={monthly}
        monthLabel={monthLabel}
        forcedBySearch={!!q.trim() && period !== 'month'}
      />

      {/* Підсумок місяця — над таблицею, бо за місяць дивляться на числа,
          а не на рядки */}
      {monthly && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3
                        flex flex-wrap gap-x-8 gap-y-2">
          {[
            ['Замовлень', summary.orders.toLocaleString('uk-UA')],
            ['Сума', money(summary.sum)],
            ['Середній чек', money(avg)],
            ['Виконано', summary.done.toLocaleString('uk-UA')],
            ['Скасовано', summary.canceled.toLocaleString('uk-UA')],
            ['Днів із доставкою', summary.days.toLocaleString('uk-UA')],
            ['Без товарів', (live.length - paid.length).toLocaleString('uk-UA')],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-zinc-500 text-xs">{label}</div>
              <div className="text-white text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Об'єднання — там, де передзамовлення видно.
          Раніше воно жило лише на вкладці «Передзамовлення», але ті самі
          замовлення частіше трапляються на очі в «Потребує уваги»: сайт
          не розпізнав адресу, і людина відкриває саме її. Об'єднати їх
          звідти було неможливо — доводилось шукати ту саму пару на іншій
          вкладці. Тепер пропонуємо скрізь, де в списку є що об'єднувати. */}
      {mergeable.length > 1 && (
        <MergePreorders
          date={date}
          candidates={mergeable.map(o => ({
            id: o.id,
            external_id: o.external_id,
            customer_name: o.customer_name,
            customer_phone: o.customer_phone,
            address: o.address,
            warehouse: o.warehouse,
            total: o.total,
          }))}
        />
      )}


      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300">
            {matcher.label} <span className="ml-1 text-zinc-500">({orders.length})</span>
            <span className="ml-2 text-zinc-600 font-normal">
              {monthly
                ? `за ${monthLabel}`
                : `на ${date.split('-').reverse().slice(0, 2).join('.')}`}
              {' · у роботі '}{active.length}
            </span>
          </h2>
        </div>
        {/*
          * Телефон і стіл — різні екрани, не той самий у масштабі.
          *
          * Одинадцять колонок на 375 пікселів не влазять ніяк: таблиця
          * їде вбік, і щоб побачити суму чи статус, треба тягнути її
          * пальцем, загубивши з очей, у чиєму рядку ти був. На складі й
          * у дорозі дивляться саме з телефона, тож там замовлення —
          * картка: усе про одне замовлення на одному екрані.
          */}
        <div className="lg:hidden divide-y divide-zinc-800/60">
          {orders.length === 0 ? (
            <div className="text-center py-10 text-zinc-500 text-sm">
              {monthly ? 'За цей місяць тут порожньо' : 'На цю дату тут порожньо'}
            </div>
          ) : orders.map(o => (
            <div key={o.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white font-semibold">
                    {o.manual_number ? `№${o.manual_number}` : o.external_id || '—'}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {platformLabel(o.platform)}
                    </span>
                  </div>
                  <div className="text-zinc-400 text-xs mt-0.5">
                    {shortDate(o.delivery_date)}
                    {o.delivery_slot && ` · ${o.delivery_slot}`}
                    {o.warehouse && ` · ${o.warehouse}`}
                  </div>
                </div>
                <div className="text-white tabular-nums whitespace-nowrap font-semibold">
                  {money(o.total)}
                </div>
              </div>

              <div className="text-sm text-zinc-200">{o.customer_name || '—'}</div>

              {/* Телефон набирається дотиком: на складі дзвонять із того
                  самого екрана, на якому дивляться замовлення */}
              {o.customer_phone && (
                <a href={`tel:${o.customer_phone.replace(/[^\d+]/g, '')}`}
                  className="text-red-400 text-sm inline-flex items-center h-11">
                  {o.customer_phone}
                </a>
              )}

              <div className="text-zinc-400 text-xs">{o.address || '—'}</div>

              {o.customer_comment && (
                <div className="text-amber-200 text-xs border-l-2 border-amber-600/60 pl-2
                                whitespace-pre-wrap break-words">
                  {o.customer_comment}
                </div>
              )}

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {o.auto_problem && (
                  <span className="text-amber-500">⚠ бракує: {o.auto_problem}</span>
                )}
                {o.bitrix_error && <span className="text-red-400">⚠ {o.bitrix_error}</span>}
                {sharesNumber(o) && <span className="text-red-400">⚠ номер зайнято двічі</span>}
                {!o.delivery_date && <span className="text-amber-500">⚠ немає дати доставки</span>}
                {o.chat_sent_at && <span className="text-emerald-600">бланк у чаті</span>}
              </div>

              {/*
                * Дії — у два рядки, і кожна по сорок чотири пікселі.
                *
                * В один рядок вони не вміщаються: на 375 пікселях селект
                * статусу стискався до двадцяти восьми, і вибрати в ньому
                * щось пальцем було неможливо. Тепер статус і бланк —
                * зверху, решта дій — під ними на всю ширину.
                *
                * Висота задається самим кнопкам, а не обгортці. Обгортка
                * на сорок чотири пікселі нічого не дає: натискають
                * кнопку, а вона всередині лишалась шістнадцять
                * пікселів заввишки — смужка, у яку з ходу не влучиш.
                */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 min-w-0 [&_select]:w-full [&_select]:h-11 [&_select]:text-sm">
                  <StatusSelect
                    id={o.id}
                    platform={o.platform}
                    externalId={o.external_id}
                    status={o.status}
                    disabled={readOnly}
                  />
                </div>
                {o.share_token && (
                  <a href={`/zamovlennya/${o.share_token}`} target="_blank" rel="noreferrer"
                    className="flex items-center h-11 px-3 rounded-lg bg-zinc-800/60
                               text-zinc-300 text-xs whitespace-nowrap">
                    Бланк ↗
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2
                              [&_button]:h-11 [&_button]:px-3 [&_button]:rounded-lg
                              [&_button]:bg-zinc-800/60 [&_button]:text-sm">
                <EditButton id={o.id} warehouses={warehouses} recheck={!!o.auto_problem} />
              </div>
            </div>
          ))}
        </div>

        <div className="hidden lg:block">
        <WideScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-3 py-2 whitespace-nowrap">Номер</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Джерело</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Доставка</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Склад</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Клієнт</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Телефон</th>
                <th className="text-left px-3 py-2">Адреса</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Сума</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Статус</th>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-zinc-500">
                    {monthly ? 'За цей місяць тут порожньо' : 'На цю дату тут порожньо'} —{' '}
                    <Link href="/orders/manual" className="text-red-400 hover:text-red-300">
                      створити замовлення
                    </Link>
                  </td>
                </tr>
              ) : orders.map(o => (
                <tr key={o.id} className="border-b border-zinc-800/60 last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="text-white">
                      {o.manual_number ? `№${o.manual_number}` : o.external_id || '—'}
                    </span>
                    {o.number_source === 'local' && (
                      <span className="block text-amber-500 text-xs" title="Номер узято локально, не з журналу">
                        не з журналу
                      </span>
                    )}
                    {o.chat_sent_at && (
                      <span className="block text-emerald-600 text-xs" title="Бланк надіслано в чат складу">
                        бланк у чаті
                      </span>
                    )}
                    {!o.auto_done_at && !o.auto_problem && (
                      <span className="block text-zinc-600 text-xs">не оглянуто</span>
                    )}
                    {/* Угода — там, де на неї дивляться. Без контакту вона
                        зветься «Угода #200596», і в CRM її не знайти ні за
                        прізвищем, ні за телефоном; посилання знімає пошук */}
                    {o.bitrix_deal_id ? (
                      <a
                        href={dealUrl(o.bitrix_deal_id) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
                        title="Відкрити угоду в Бітріксі"
                      >
                        угода #{o.bitrix_deal_id} ↗
                      </a>
                    ) : (
                      <span className="block text-amber-500 text-xs"
                        title="Замовлення живе лише в Мерчанті — у CRM його немає">
                        ⚠ немає угоди в Бітріксі
                      </span>
                    )}
                    {o.bitrix_error && (
                      <span className="block text-red-400 text-xs">⚠ {o.bitrix_error}</span>
                    )}
                    {sharesNumber(o) && (
                      <span className="block text-red-400 text-xs"
                        title="Цього дня під цим номером є ще одне замовлення">
                        ⚠ номер зайнято двічі
                      </span>
                    )}
                    {sharesPerson(o) && (
                      <span className="block text-amber-500 text-xs"
                        title="Той самий телефон на цю дату — схоже, замовлення завели двічі">
                        ⚠ той самий клієнт цього дня
                      </span>
                    )}
                    {!o.delivery_date && (
                      <span className="block text-amber-500 text-xs"
                        title="В угоді не заповнена дата доставки — замовлення не належить жодному дню">
                        ⚠ немає дати доставки
                      </span>
                    )}
                    {Number(o.total ?? 0) === 0 && o.status !== 'Скасовано' && (
                      <span className="block text-amber-500 text-xs"
                        title="В угоді немає жодної позиції — збирати нема чого">
                        ⚠ угода без товарів
                      </span>
                    )}
                    {/* Оцінка клієнта — поруч із номером, бо саме за номером
                        про замовлення й згадують */}
                    {o.review?.[0] && (
                      <span
                        className="block text-amber-400 text-xs"
                        title={o.review[0].comment ?? 'Без коментаря'}
                      >
                        {'\u2605'.repeat(o.review[0].rating)}
                        <span className="text-zinc-600">
                          {'\u2606'.repeat(5 - o.review[0].rating)}
                        </span>
                        {o.review[0].comment ? ' ✍' : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium
                                     bg-zinc-800 text-zinc-300">
                      {platformLabel(o.platform)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-300 whitespace-nowrap text-xs">
                    {shortDate(o.delivery_date)}
                    {o.delivery_slot && <span className="block text-zinc-500">{o.delivery_slot}</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 text-xs whitespace-nowrap">
                    {o.warehouse || '—'}
                    {o.delivery_zone && (
                      <span className="block text-zinc-600">{o.delivery_zone}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{o.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{o.customer_phone || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs max-w-[18rem]">
                    {o.address || '—'}
                    {/* Коментар покупця — поруч з адресою, бо найчастіше
                        він саме про неї: домофон, під'їзд, «подзвоніть
                        перед приїздом». Читати його треба до того, як
                        замовлення поїде, а не після дзвінка клієнта */}
                    {o.customer_comment && (
                      <span className="block mt-1 text-amber-200 border-l-2 border-amber-600/60 pl-2
                                       whitespace-pre-wrap break-words">
                        {o.customer_comment}
                      </span>
                    )}
                    {o.auto_problem && (
                      <span className="block text-amber-500 mt-0.5">
                        ⚠ бракує: {o.auto_problem}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-white tabular-nums whitespace-nowrap">
                    {money(o.total)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusSelect
                      id={o.id}
                      platform={o.platform}
                      externalId={o.external_id}
                      status={o.status}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <EditButton id={o.id} warehouses={warehouses} recheck={!!o.auto_problem} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.share_token && (
                      <a
                        href={`/zamovlennya/${o.share_token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-400 hover:text-white text-xs transition-colors"
                      >
                        Бланк ↗
                      </a>
                    )}
                    {/* Видалення поруч із бланком, але приглушене: це не
                        щоденна дія, і виглядати вона має відповідно */}
                    {!readOnly && (
                      <DeleteButton
                        id={o.id}
                        label={o.manual_number ? `№${o.manual_number}` : (o.external_id ?? 'замовлення')}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </WideScroll>
        </div>
      </div>
    </div>
  )
}
