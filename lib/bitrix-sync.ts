/**
 * Замовлення з сайту — з Бітрікса в Мерчант.
 *
 * Сайт складає замовлення в CRM, і для Мерчанта вона першоджерело: ми не
 * вигадуємо їх наново, а забираємо. Забираємо лише те, що змінилось — у
 * воронці сто двадцять тисяч угод, і повне вичитування не має сенсу ні разу
 * на п'ять хвилин, ні взагалі.
 */
import { randomBytes } from 'node:crypto'
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'
import { stageName, CLOSED_STAGES } from '@/lib/bitrix-stages'
import { WAREHOUSE_ID, CATEGORY_ID } from '@/lib/bitrix-deal'
import { slotLabel } from '@/lib/bitrix-slots'
import { noteExternalNumber } from '@/lib/number-register'
import { onStatusChanged } from '@/lib/bitrix-chat'
import { logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { moveNumber } from '@/lib/manual-register'
import { splitPersona } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

/** Чиї замовлення веде майданчик, а не ми */
const MARKETPLACE_PLATFORMS = new Set(['maudau', 'rozetka'])

const WAREHOUSE_BY_ID = new Map(
  Object.entries(WAREHOUSE_ID).map(([name, id]) => [String(id), name]),
)
interface Deal {
  ID: string
  TITLE: string
  STAGE_ID: string
  CONTACT_ID: string | null
  OPPORTUNITY: string
  DATE_CREATE: string
  DATE_MODIFY: string
  COMMENTS: string | null
  UF_CRM_1607510002583: string | null   // номер ящика
  UF_BILL_ADRESS_LIST: string | null    // склад
  UF_CRM_1606047095: string | null      // дата доставки
  UF_CRM_1606047143435: string | null   // період
  UF_CRM_1606294264905: string | null   // адреса
  UF_DEST_PERSONA: string | null
  UF_ORDER_KEY: string | null
}

const DEAL_FIELDS = [
  'ID', 'TITLE', 'STAGE_ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'DATE_MODIFY',
  'COMMENTS', 'UF_CRM_1607510002583', 'UF_BILL_ADRESS_LIST', 'UF_CRM_1606047095',
  'UF_CRM_1606047143435', 'UF_CRM_1606294264905', 'UF_DEST_PERSONA', 'UF_ORDER_KEY',
]

/** Телефони й імена контактів — одним запитом на всю сторінку угод. */
async function contacts(ids: string[]) {
  const map = new Map<string, { name: string; phone: string | null }>()
  if (!ids.length) return map

  const rows = await bitrix<{
    ID: string; NAME: string | null; LAST_NAME: string | null
    PHONE?: { VALUE: string }[]
  }[]>('crm.contact.list', {
    filter: { ID: ids },
    select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'],
  })

  for (const c of rows ?? []) {
    map.set(c.ID, {
      name: [c.LAST_NAME, c.NAME].filter(Boolean).join(' ').trim(),
      phone: c.PHONE?.[0]?.VALUE ?? null,
    })
  }
  return map
}

interface Row {
  PRODUCT_ID: string; PRODUCT_NAME: string; PRICE: string; QUANTITY: string
  MEASURE_NAME?: string | null
}

/**
 * Одиниця позиції.
 *
 * Бітрікс присилає свою міру — «кг», «шт», «Пачка». Писати всюди «шт»
 * означало б показати «0.6 шт філе» там, де насправді 600 грамів: комірник
 * збере не те, а оператор не помітить.
 */
function unitOf(row: Row): string {
  const m = (row.MEASURE_NAME ?? '').trim().toLowerCase()
  if (m.startsWith('кг')) return 'кг'
  if (m) return 'шт'
  // Міри немає — дробова кількість сама себе видає: штуками так не беруть
  return Number(row.QUANTITY) % 1 === 0 ? 'шт' : 'кг'
}

/**
 * Позиції одразу для багатьох угод.
 *
 * Бітрікс уміє приймати пачку викликів одним запитом — п'ятдесят за раз.
 * Поодинці це був би запит на кожну угоду, тобто сотня запитів на одну
 * синхронізацію.
 */
async function productRows(dealIds: string[]) {
  const out = new Map<string, Row[]>()

  for (let i = 0; i < dealIds.length; i += 50) {
    const chunk = dealIds.slice(i, i + 50)
    const cmd: Record<string, string> = {}
    for (const id of chunk) cmd[`d${id}`] = `crm.deal.productrows.get?id=${id}`

    const res = await bitrix<{
      result: Record<string, Row[]>
      result_error?: Record<string, unknown>
    }>('batch', { halt: 0, cmd })

    /*
     * Порожньо — це не те саме, що «не відповіли».
     *
     * Коли підзапит падає (а під навантаженням Бітрікс зрізає саме їх),
     * у відповіді для цієї угоди немає нічого. Раніше ми писали сюди
     * порожній список — і далі він означав «товарів немає», тобто склад
     * замовлення стирався. Шість одночасних проходів так вичистили
     * замовлення до нуля.
     *
     * Тепер угоду, про яку нам не сказали, просто не згадуємо: позиції
     * лишаються як були, а наступний прохід спитає ще раз.
     */
    for (const id of chunk) {
      const rows = res?.result?.[`d${id}`]
      if (Array.isArray(rows) && !res?.result_error?.[`d${id}`]) out.set(id, rows)
    }
  }
  return out
}

export interface SyncResult {
  seen: number
  created: number
  updated: number
  /** Де спинились — щоб продовжити добір наступним викликом */
  nextPage?: number | null
  /** Номери, які не вдалося перенести в журналі — щоб це не губилось мовчки */
  notes?: string[]
  /** Угоди маркетплейсних замовлень — їх веде майданчик, ми їх не чіпаємо */
  skipped?: number
  error?: string
}

/**
 * Забирає з Бітрікса угоди, змінені від `since`.
 *
 * Угоди, створені з наших же ручних замовлень, теж сюди потрапляють — і це
 * правильно: якщо оператор пересунув таке замовлення в CRM, Мерчант має
 * показувати те саме.
 */
export async function syncSiteOrders(
  service: Service,
  { since, maxPages = 10, dealIds, byCreated = false, startPage = 0 }: {
    since?: string
    maxPages?: number
    /** Конкретні угоди — коли Бітрікс сам сказав, яка саме змінилась */
    dealIds?: (string | number)[]
    /**
     * Шукати за датою створення, а не зміни.
     *
     * Для щоденної роботи важить зміна: що поправили, те й перечитуємо. Але
     * коли добираємо минуле, замовлення тижневої давнини ніхто вже не чіпає
     * — його знайде лише дата створення.
     */
    byCreated?: boolean
    /** З якої сторінки продовжити — довгий добір іде частинами */
    startPage?: number
  },
): Promise<SyncResult> {
  const result: SyncResult = { seen: 0, created: 0, updated: 0 }
  /**
   * Останнє зачеплене замовлення — для одного сповіщення наприкінці.
   *
   * Сповіщати про кожне окремо означає сотню повідомлень за прохід, і
   * сторінка, яка перечитує себе на кожне, перестає відповідати.
   */
  let touched: string | null = null

  try {
    for (let page = 0; page < maxPages; page++) {
      const filter: Record<string, unknown> = { CATEGORY_ID }
      if (dealIds?.length) filter.ID = dealIds
      else if (since) filter[byCreated ? '>=DATE_CREATE' : '>=DATE_MODIFY'] = since

      const deals = await bitrix<Deal[]>('crm.deal.list', {
        filter,
        select: DEAL_FIELDS,
        order: byCreated ? { ID: 'ASC' } : { DATE_MODIFY: 'ASC' },
        start: (startPage + page) * 50,
      })

      if (!deals?.length) break
      result.seen += deals.length

      const people = await contacts(
        [...new Set(deals.map(d => d.CONTACT_ID).filter(Boolean) as string[])],
      )
      const rowsByDeal = await productRows(deals.map(d => d.ID))

      for (const deal of deals) {
        const person = deal.CONTACT_ID ? people.get(deal.CONTACT_ID) : undefined
        const status = stageName(deal.STAGE_ID) ?? deal.STAGE_ID
        /*
         * Чи знаємо ми склад цієї угоди просто зараз.
         *
         * Якщо Бітрікс про неї не відповів, позиції не чіпаємо зовсім:
         * краще показати вчорашній склад, ніж стерти сьогоднішній.
         */
        const knownRows = rowsByDeal.has(deal.ID)
        const rows = rowsByDeal.get(deal.ID) ?? []

        /*
         * Контакта в угоді може не бути зовсім — тоді ім'я, телефон і
         * пошта стоять одним рядком у полі «отримувач». Без розбору
         * замовлення лишалось без телефону, а отже без клієнта, без
         * історії покупок і без картки в Trello, яку нема за чим зчепити.
         */
        const persona = splitPersona(deal.UF_DEST_PERSONA)

        const fields = {
          external_id: `BX-${deal.ID}`,
          platform: 'site',
          bitrix_deal_id: Number(deal.ID),
          order_date: deal.DATE_CREATE.slice(0, 10),
          /*
           * Порожнє поле — це не дата.
           *
           * Бітрікс віддає незаповнену дату доставки порожнім рядком, а
           * не відсутністю. `''.slice(0, 10)` дає знову порожній рядок,
           * і Postgres відмовляє всій вставці: «invalid input syntax for
           * type date». Два жовтневі замовлення так і не потрапили в
           * Мерчант — вони просто не мали дати.
           */
          delivery_date: deal.UF_CRM_1606047095?.slice(0, 10) || null,
          delivery_slot: await slotLabel(deal.UF_CRM_1606047143435),
          warehouse: WAREHOUSE_BY_ID.get(deal.UF_BILL_ADRESS_LIST ?? '') ?? null,
          customer_name: person?.name || persona.name || deal.TITLE,
          customer_phone: person?.phone ?? persona.phone,
          address: deal.UF_CRM_1606294264905 ?? null,
          status,
          /*
           * Суму рахуємо з позицій, а не беремо з поля угоди.
           *
           * Поле «сума» в цій воронці живе своїм життям: його виставили
           * вручну колись на початку, і далі воно не йде за позиціями.
           * Записати його через API теж не виходить — Бітрікс відповідає
           * «готово» й лишає старе число. Замовлення №9 показувало 3860 ₴
           * у списку й на бланку, а в редакторі — 3944,50: саме стільки
           * коштують його одинадцять позицій після звірки ваги.
           *
           * Позиції — це те, що справді збирають і за що платять, тож
           * рахуємо по них. Поле угоди лишається запасним варіантом для
           * угоди, у якій позицій немає зовсім.
           */
          total: knownRows && rows.length
            ? Math.round(rows.reduce(
                (sum, r) => sum + Number(r.PRICE) * Number(r.QUANTITY), 0) * 100) / 100
            : Number(deal.OPPORTUNITY ?? 0),
          commission: 0,
          manual_number: deal.UF_CRM_1607510002583
            ? Number(deal.UF_CRM_1607510002583) || null
            : null,
          customer_comment: deal.COMMENTS?.trim() || null,
          // Перелік теж лишаємо старим, коли складу не знаємо
          ...(knownRows ? {
            items: rows.map(r =>
              `${r.PRODUCT_NAME}, ${Number(r.QUANTITY)} ${unitOf(r)} x ${Number(r.PRICE)} грн`)
              .join('\n'),
          } : {}),
          updated_at: new Date().toISOString(),
        }

        const { data: existing } = await service
          .from('orders')
          .select('id, platform, status, address, delivery_date, manual_number, number_source, customer_phone, auto_problem')
          .eq('bitrix_deal_id', Number(deal.ID)).maybeSingle()

        if (existing) {
          /*
           * Маркетплейсне замовлення цій синхронізації не належить зовсім.
           *
           * Угоду для нього завели ми самі, щоб склад його побачив, — але
           * господар даних там майданчик: і позиції, і суми, і статуси в
           * нього свої. Перечитувати їх з угоди означало класти другий
           * комплект позицій поверх першого (замовлення на 813 ₴ ставало
           * на 1626 ₴) і писати в статус слова з чужого словника.
           */
          if (MARKETPLACE_PLATFORMS.has(existing.platform as string)) {
            result.skipped = (result.skipped ?? 0) + 1
            continue
          }

          /**
           * Ручне замовлення ми ведемо самі.
           *
           * Воно народилось у Мерчанті: склад, період, адреса й позиції тут
           * точніші, ніж те, що з них вийшло в угоді. З Бітрікса беремо лише
           * статус — його там і міняють.
           */
          const ours = existing.platform === 'manual'

          /*
           * Привід оглянути замовлення ще раз.
           *
           * Адресу поправили — зону й склад треба перерахувати. Або
           * з'явився телефон там, де його бракувало: огляд устиг
           * записати «бракує телефону» й закрити замовлення, і без
           * повторного огляду воно так і лишилось би без номера.
           */
          const gainedPhone = !existing.customer_phone && !!fields.customer_phone
          const readdressed = !ours
            && (existing.address !== fields.address
              || (!!existing.auto_problem && gainedPhone))

          await service.from('orders')
            .update(ours
              ? { status, updated_at: fields.updated_at }
              : readdressed ? { ...fields, auto_done_at: null } : fields)
            .eq('id', existing.id)

          if (!ours && knownRows) await saveRows(service, existing.id as string, rows)

          /**
           * Дату перенесли в Бітріксі — номер має переїхати в журналі.
           *
           * Перенесення через Мерчант журнал уже чинило, але день замовлення
           * частіше міняють у самій угоді: на складі тоді лишався аркуш, де
           * замовлення стоїть у вчорашньому дні, а комірник збирає за
           * аркушем. Тут той самий переїзд, тільки з іншого входу.
           */
          if (
            !ours
            && existing.number_source === 'sheet'
            && existing.manual_number != null
            && existing.delivery_date
            && fields.delivery_date
            && existing.delivery_date !== fields.delivery_date
          ) {
            const moved = await moveNumber(service, {
              number: Number(existing.manual_number),
              fromDate: existing.delivery_date as string,
              toDate: fields.delivery_date,
              customerName: fields.customer_name || 'замовлення',
              orderId: existing.id as string,
            })
            if (moved.note) {
              result.notes = [...(result.notes ?? []), `№${existing.manual_number}: ${moved.note}`]
            }

            /*
             * Номер міг змінитись — старе число на новому дні бувало
             * зайняте. Тоді правимо і в себе, і в угоді: номер ящика
             * читають зі складу саме з Бітрікса.
             */
            if (moved.ok && moved.number !== Number(existing.manual_number)) {
              await service.from('orders')
                .update({ manual_number: moved.number }).eq('id', existing.id)
              await bitrix('crm.deal.update', {
                id: Number(deal.ID),
                fields: { UF_CRM_1607510002583: String(moved.number) },
              })
            }
          }

          /*
           * Номер, проставлений у 1С, журнал теж має побачити.
           *
           * Раніше такий номер приїжджав просто на замовлення, а в
           * журналі ящик лишався вільним — і наступне замовлення дня
           * спокійно отримувало те саме число. Запис робимо лише на
           * вільний рядок: чужий не перебиваємо.
           */
          if (fields.manual_number != null && fields.delivery_date) {
            await noteExternalNumber(service, {
              date: fields.delivery_date,
              number: Number(fields.manual_number),
              orderId: existing.id as string,
              customerName: fields.customer_name ?? null,
            })
          }

          // Статус міняють здебільшого в CRM — бланк має піти й тоді
          if (existing.status !== status) {
            /*
             * Зміна з Бітрікса теж належить журналу.
             *
             * Досі записувались лише ті, що робили в Мерчанті, — і коли
             * замовлення вранці поверталось із «Виконано» у «Спаковано»,
             * у журналі про це не було ні слова. Шукати причину
             * доводилось у стрічці угоди, і то якщо здогадатись.
             */
            await logOrderEvent(service, existing.id as string, 'status',
              { old: existing.status as string | null, new: status },
              { id: '', name: 'Бітрікс' })

            await onStatusChanged(service, existing.id as string, status)
            touched = existing.id as string
          }
          result.updated++
        } else {
          /**
           * Токен бланка — одразу при появі замовлення.
           *
           * Без нього посилання на бланк не існує, і в чат складу надсилати
           * нічого: замовлення доходило до комплектації, а комірник його не
           * бачив. Ручний прийом токен видавав, синхронізація — ні.
           */
          const { data: created, error } = await service
            .from('orders')
            .insert({ ...fields, share_token: randomBytes(18).toString('base64url') })
            .select('id').single()

          if (created) {
            if (knownRows) await saveRows(service, created.id as string, rows)
            touched = created.id as string
            result.created++

            if (fields.manual_number != null && fields.delivery_date) {
              await noteExternalNumber(service, {
                date: fields.delivery_date,
                number: Number(fields.manual_number),
                orderId: created.id as string,
                customerName: fields.customer_name ?? null,
              })
            }
          } else {
            /*
             * Невдала вставка більше не губиться.
             *
             * Доти помилка просто відкидалась, і прохід звітував «seen: 1,
             * created: 0» — тобто все гаразд, просто нічого не сталось.
             * Замовлення не існувало ніде, і дізнатись про це можна було
             * лише з Бітрікса очима.
             */
            result.notes = [
              ...(result.notes ?? []),
              `#${deal.ID}: ${error?.message ?? 'не вдалося створити'}`,
            ]
          }
        }
      }

      if (deals.length < 50) { result.nextPage = null; break }
      result.nextPage = startPage + page + 1
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  if (touched) await broadcastOrderChange(touched, 'sync')

  return result
}

/**
 * Позиції замовлення переписуються цілком.
 *
 * Зіставляти рядок із рядком нема за чим: у Бітріксі в позиції немає свого
 * сталого номера, тільки порядок. Зате склад замовлення там — остання правда,
 * тож просто беремо його таким, як є.
 */
/**
 * Номер товару в Бітріксі → наш товар.
 *
 * Міст між ними — код 1С: у Бітріксі він лежить у XML_ID, у нас у
 * `uid_1c`. Відповідність кешуємо в `bitrix_products`, тож за звичайний
 * прохід мережі не торкаємось зовсім.
 */
async function linkProducts(service: Service, rows: Row[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const ids = [...new Set(rows.map(r => Number(r.PRODUCT_ID)).filter(Boolean))]
  if (!ids.length) return out

  const { data: known } = await service
    .from('bitrix_products').select('uid_1c, product_id').in('product_id', ids)

  const uidByBitrix = new Map(
    (known ?? []).map(k => [Number(k.product_id), k.uid_1c as string]),
  )

  const unknown = ids.filter(id => !uidByBitrix.has(id))
  if (unknown.length) {
    try {
      const found = await bitrix<{ ID: string; NAME: string; XML_ID: string }[]>(
        'crm.product.list',
        { filter: { ID: unknown }, select: ['ID', 'NAME', 'XML_ID'] },
      )
      const fresh = (found ?? []).filter(p => p.XML_ID).map(p => ({
        uid_1c: p.XML_ID, product_id: Number(p.ID), name: p.NAME,
      }))
      for (const p of fresh) uidByBitrix.set(p.product_id, p.uid_1c)
      if (fresh.length) {
        await service.from('bitrix_products').upsert(fresh, { onConflict: 'uid_1c' })
      }
    } catch {
      // Не дізнались — позиція просто лишиться без товару, як було досі
    }
  }

  const uids = [...new Set(uidByBitrix.values())]
  if (!uids.length) return out

  const { data: ours } = await service
    .from('products').select('id, uid_1c').in('uid_1c', uids)

  const byUid = new Map((ours ?? []).map(p => [p.uid_1c as string, p.id as string]))
  for (const [bitrixId, uid] of uidByBitrix) {
    const our = byUid.get(uid)
    if (our) out.set(bitrixId, our)
  }

  return out
}

async function saveRows(service: Service, orderId: string, rows: Row[]) {
  /**
   * Чи були товари до цього.
   *
   * Сайт створює угоду раніше, ніж додає до неї позиції, тож перший погляд
   * бачить порожнє замовлення й чесно каже «бракує товарів». Коли позиції
   * приїжджають, висновок застаріває — і замовлення має оглянутись заново.
   */
  const { count: before } = await service
    .from('order_items').select('id', { count: 'exact', head: true })
    .eq('order_id', orderId).eq('removed', false)

  if (!rows.length) {
    await service.from('order_items').delete().eq('order_id', orderId).eq('source', 'site')
    if (before) await service.from('orders').update({ auto_done_at: null }).eq('id', orderId)
    return
  }

  if (!before) await service.from('orders').update({ auto_done_at: null }).eq('id', orderId)

  /*
   * Позиція має знати, який це товар, а не лише як він називався.
   *
   * Бітрікс дає свій номер товару, і цього досить, щоб дійти до нашого
   * каталогу: номер → XML_ID (він же код 1С) → наш товар. Поки цього
   * зв'язку не було, аналітика «що найкраще продається» впиралась у
   * рядок із назвою — а назву в CRM правлять, і той самий товар у ній
   * писався трьома способами.
   */
  const ourByBitrix = await linkProducts(service, rows)

  /*
   * Заміна однією транзакцією.
   *
   * Раніше тут були два кроки — видалити старі рядки, вставити нові, — і
   * між ними замовлення на коротку мить лишалось без позицій. Той, хто
   * читав саме тоді, бачив порожнечу як правду: об'єднання взяло три
   * позиції замість одинадцяти, бо друге замовлення читалось якраз у цю
   * щілину. Тепер назовні видно або старий склад, або новий.
   */
  await service.rpc('replace_order_items', {
    p_order_id: orderId,
    p_source: 'site',
    p_rows: rows.map((r, i) => ({
      position: i,
      title: r.PRODUCT_NAME,
      bitrix_product_id: Number(r.PRODUCT_ID) || null,
      product_id: ourByBitrix.get(Number(r.PRODUCT_ID)) ?? null,
      unit: unitOf(r),
      unit_weight: 0,
      price_per_unit: Number(r.PRICE),
      ordered_qty: Number(r.QUANTITY),
      ordered_total: Math.round(Number(r.PRICE) * Number(r.QUANTITY) * 100) / 100,
    })),
  })
}

/** Замовлення, які ще в роботі — їх варто перепитувати навіть без змін. */
export const isOpenOrder = (status: string | null) =>
  !!status && !CLOSED_STAGES.includes(status)
