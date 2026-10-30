/**
 * Самостійне опрацювання замовлень із сайту й телефону.
 *
 * Сайт складає замовлення сам, але готовим до складу воно від цього не стає:
 * номера з журналу в ньому немає, а склад підставлений тим, що вибрав
 * покупець, — і це не завжди той склад, звідки реально поїде. Робимо те, що
 * доти робив оператор руками: беремо номер, звіряємо адресу із зонами,
 * перевіряємо, що в замовленні є все потрібне.
 *
 * Телефонні проходять той самий огляд. Номер і склад у них уже є — їх
 * назвала людина, — але адресу варто звірити із зонами, а комплектність
 * перевірити так само: помилитись, набираючи зі слів клієнта, легше, ніж
 * заповнюючи форму.
 *
 * Далі не чіпаємо. Бланк піде у свій час — коли замовлення поставлять на
 * комплектацію, не раніше: доти його ще можуть скасувати чи переписати.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { resolveAddress, GeocoderUnavailable, areaFromDisplay } from '@/lib/delivery-zones'
import { reserveNumber, linkNumber } from '@/lib/manual-register'
import { bitrix } from '@/lib/bitrix'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { CLOSED_STAGES } from '@/lib/bitrix-stages'

type Service = ReturnType<typeof createServiceClient>

const FIELD = {
  boxNumber: 'UF_CRM_1607510002583',
  warehouse: 'UF_BILL_ADRESS_LIST',
} as const

import { WAREHOUSE_ID } from '@/lib/bitrix-deal'

interface Row {
  id: string
  external_id: string | null
  bitrix_deal_id: number | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  warehouse: string | null
  delivery_zone: string | null
  warehouse_pinned: boolean | null
  delivery_date: string | null
  delivery_slot: string | null
  manual_number: number | null
  number_source: string | null
  status: string | null
  total: number | null
  created_at: string | null
  /** День самого замовлення; `created_at` — це лише час нашого імпорту */
  order_date: string | null
}

export interface AutopilotResult {
  looked: number
  numbered: number
  rezoned: number
  problems: number
  /** Скільки других примірників зупинено, не давши їм номера */
  twins: number
  /** Замовлення, відкладені через мовчання геокодера */
  postponed: number
  /** Скільки карток одразу поїхало на дошку */
  carded?: number
  error?: string
}

/**
 * Чого бракує, щоб замовлення поїхало.
 *
 * Перевіряємо те, без чого його не зібрати й не привезти. Нічого не
 * вигадуємо: якщо телефону немає, то немає — хай це побачить людина.
 */
function missingFields(order: Row, items: number): string[] {
  const missing: string[] = []
  if (!order.customer_name?.trim()) missing.push('ПІБ')
  if (!order.customer_phone?.trim()) missing.push('телефон')
  if (!order.address?.trim()) missing.push('адреса')
  if (!order.delivery_date) missing.push('дата доставки')
  if (!order.delivery_slot) missing.push('період доставки')
  if (!items) missing.push('товари')
  return missing
}

/** Самі цифри номера: «+38 (067) 335-71-55» і «380673357155» — одне й те саме */
const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').slice(-9)

/** Скільки часу між двома однаковими замовленнями ще означає подвійне натискання */
const TWIN_MINUTES = 30

/**
 * Чи це другий примірник уже наявного замовлення.
 *
 * Сайт уміє покласти ту саму форму двічі: угоди #200886 і #200887
 * народились з різницею в двісті мілісекунд — той самий телефон, та сама
 * адреса, та сама сума, той самий період. Для складу це два ящики
 * замість одного, і хтось із двох клієнтів свого замовлення не отримає.
 *
 * Збігом вважаємо телефон, день і період доставки, день самого
 * замовлення й суму до копійки протягом півгодини. Телефон порівнюємо
 * самими цифрами, бо сайт і Бітрікс пишуть його по-різному. Повторне
 * замовлення того самого дня — річ звичайна, але не на ту саму копійку,
 * не в той самий період і не за півгодини.
 *
 * Нульова сума збігом не вважається: порожнє замовлення — це те, чиї
 * позиції ще не приїхали, і таких за один завіз буває кілька підряд.
 * День самого замовлення теж звіряємо, бо наш `created_at` — це час
 * імпорту: під час разового перезавантаження історії сотні чужих одна
 * одній угод лягли в базу з різницею в секунди.
 *
 * За два місяці правило знайшло п'ять таких пар — приблизно одну на
 * півтора тижня.
 *
 * Старший примірник лишається робочим, молодший зупиняємо: номера не
 * беремо, на дошку не відправляємо, у чат складу нічого не йде, бо
 * статус не міняється. Скасовувати угоду самі не беремось — замовлення
 * чуже, і останнє слово за оператором.
 */
async function twinOf(service: Service, order: Row): Promise<Row | null> {
  const phone = digits(order.customer_phone)
  if (!phone || !order.delivery_date || !order.created_at) return null
  if (!order.total || Number(order.total) <= 0) return null

  const { data } = await service
    .from('orders')
    .select('id, external_id, manual_number, customer_phone, total, created_at, delivery_slot')
    .in('platform', ['site', 'manual'])
    .eq('delivery_date', order.delivery_date)
    .eq('order_date', order.order_date)
    .neq('id', order.id)
    .neq('status', 'Скасовано')
    .lt('created_at', order.created_at)

  const window = TWIN_MINUTES * 60_000
  const mine = new Date(order.created_at).getTime()

  const twin = (data ?? []).find(o =>
    digits(o.customer_phone as string | null) === phone
    && (o.delivery_slot ?? '') === (order.delivery_slot ?? '')
    && Math.abs(Number(o.total ?? -1) - Number(order.total)) < 0.01
    && mine - new Date(o.created_at as string).getTime() < window)

  return (twin as Row | undefined) ?? null
}

/**
 * Замовлення, яке не доїхало до Бітрікса, заводимо ще раз.
 *
 * Телефонне замовлення вирушає в CRM один раз — тієї миті, коли його
 * прийняли. Якщо Бітрікс у ту секунду відповів помилкою (а він відповідає:
 * «crm.deal.add: SQL query error!» на замовленні МР-02.11-1), другої
 * спроби не було ніколи. Правка замовлення теж не рятувала: вона шле
 * зміни в угоду, якої немає. Замовлення лишалось жити лише в Мерчанті —
 * і дізнавались про це з того, що воно не з'явилось у складу.
 *
 * Беремо тільки свої, телефонні: угода для них наша й має бути. Чуже
 * замовлення з сайту без угоди — це угода, яку хтось свідомо видалив, і
 * відроджувати її не нам.
 */
export async function retryStranded(
  service: Service,
  { limit = 5 }: { limit?: number } = {},
): Promise<{ tried: number; pushed: number; problems: string[] }> {
  const out = { tried: 0, pushed: 0, problems: [] as string[] }

  // Тиждень — межа розумного: старше вже розбирали руками
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const { data } = await service
    .from('orders')
    .select('id, external_id')
    .eq('platform', 'manual')
    .is('bitrix_deal_id', null)
    .gte('created_at', since)
    .not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)
    .limit(limit)

  for (const order of data ?? []) {
    out.tried++
    const { pushOrderToBitrix } = await import('@/lib/bitrix-deal')
    const res = await pushOrderToBitrix(service, order.id as string)
    if ('dealId' in res) out.pushed++
    else out.problems.push(`${order.external_id}: ${res.error}`)
  }

  return out
}

export async function autoProcessSiteOrders(
  service: Service,
  { limit = 50, orderIds }: { limit?: number; orderIds?: string[] } = {},
): Promise<AutopilotResult> {
  const result: AutopilotResult = {
    looked: 0, numbered: 0, rezoned: 0, problems: 0, postponed: 0, twins: 0,
  }
  // Одне сповіщення наприкінці — див. те саме міркування в синхронізації
  let touched: string | null = null
  /** Що пройшло огляд без хиб — їхні картки можна рушати на дошці */
  const reviewed: string[] = []

  try {
    /**
     * Закриті відсіюємо запитом, а не після нього.
     *
     * Доти вони лишались у вибірці, фільтрувались уже в пам'яті — і порція
     * виходила порожньою, бо на початку черги стояли саме вони. Черга
     * заблокувалась намертво: нові замовлення не оглядались місяцями, бо
     * попереду вічно стояв десяток скасованих.
     */
    /**
     * Оглядаємо те, що ще поїде.
     *
     * Замовлення позавчорашнє вже або привезли, або ні — перевіряти в ньому
     * зону доставки запізно, а черга від таких тільки довшає. Вікно — від
     * учора: сьогоднішні везуть, учорашні ще можуть переноситись.
     */
    const horizon = new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10)

    let query = service
      .from('orders')
      .select('id, external_id, bitrix_deal_id, customer_name, customer_phone, address, warehouse, warehouse_pinned, delivery_zone, delivery_date, delivery_slot, manual_number, number_source, status, total, created_at, order_date')
      .in('platform', ['site', 'manual'])
      .is('auto_done_at', null)
      .gte('delivery_date', horizon)
      .not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)

    // Названі замовлення — коли Бітрікс щойно сказав, що саме змінилось
    if (orderIds?.length) query = query.in('id', orderIds)

    const { data } = await query.order('created_at', { ascending: true }).limit(limit)

    const orders = (data ?? []) as Row[]
    result.looked = orders.length

    for (const order of orders) {
      /**
       * Що саме зараз оглядаємо.
       *
       * Черга йде за часом надходження, і з боку оператора це довга пауза,
       * у якій незрозуміло, чи щось узагалі відбувається. Запис про поточне
       * замовлення робить роботу видимою.
       */
      await service.from('app_settings').upsert({
        key: 'autopilot_now',
        value: {
          external_id: order.external_id,
          customer: order.customer_name,
          at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })

      const { count } = await service
        .from('order_items').select('id', { count: 'exact', head: true })
        .eq('order_id', order.id).eq('removed', false)

      const problems = missingFields(order, count ?? 0)
      const patch: Record<string, unknown> = {}
      const crm: Record<string, unknown> = {}

      /*
       * Близнюка далі не ведемо.
       *
       * Усе, що нижче, готує замовлення до складу: бере номер із
       * журналу, ставить склад, виштовхує картку на дошку. Для другого
       * примірника кожна з цих дій — зайвий ящик, зайвий номер і зайвий
       * рядок у чергу комплектації. Тож зупиняємось тут і лишаємо
       * помітку з номером старшого примірника, щоб оператору не треба
       * було шукати, котре з двох справжнє.
       */
      const twin = await twinOf(service, order)
      if (twin) {
        const which = twin.manual_number != null
          ? `№${twin.manual_number}`
          : twin.external_id ?? 'попереднього'
        patch.auto_problem = `схоже на дублікат ${which} — та сама сума й телефон; `
          + 'перевірте й скасуйте зайве'
        /*
         * Посилання, а не самий лише напис.
         *
         * За написом у «потребує уваги» решта системи близнюка не
         * впізнає: журнал номерів і дошка бачать два рівноправні
         * замовлення на той самий телефон і день — і Trello, не вміючи
         * вибрати між ними, лишає без номера обидві картки. Саме так
         * сімнадцяте сьогодні лишилось без картки взагалі.
         */
        patch.duplicate_of = twin.id
        patch.auto_done_at = new Date().toISOString()
        await service.from('orders').update(patch).eq('id', order.id)
        touched = order.id
        result.problems++
        result.twins++
        continue
      }

      /**
       * Зона й склад — з адреси. Те, що вибрав покупець, буває не тим
       * складом, звідки реально везуть.
       *
       * Якщо геокодер мовчить, замовлення не отримує вироку «адресу не
       * розпізнано»: воно просто лишається в черзі. Відмова сервісу — не
       * факт про адресу.
       */
      if (order.address?.trim()) {
        try {
          const zone = await resolveAddress(service, order.address, order.delivery_date)
          // Район або село — для аналітики доставок
          patch.area = areaFromDisplay(zone.point?.display_name) ?? null

          if (zone.zone) {
            /*
             * Зону записуємо лише тоді, коли їй можна вірити.
             *
             * Приблизний збіг — це вулиця без номера або сам населений
             * пункт, і точка лягає туди, де стоїть центр міста. Склад за
             * нею ми свідомо не міняємо (нижче), а зону доти писали —
             * і в списку виходило «zone_1, Гуртівня», де одне суперечить
             * іншому. Так замовлення №21 за 24 жовтня простояло весь
             * день: вулиці Зимновідської геокодер не знає, точка впала в
             * центр, зона записалась чужа.
             */
            if (!zone.point?.approximate) patch.delivery_zone = zone.zone

            /**
             * Склад міняємо лише за точним збігом.
             *
             * Приблизний — це вулиця без номера будинку, а довга вулиця
             * перетинає кілька зон: переставити за ним склад означає
             * відправити замовлення в інший кінець міста з виглядом
             * упевненості.
             */
            if (order.warehouse_pinned) {
              /*
               * Склад обрала людина — огляд його не чіпає.
               *
               * Оператор бачить те, чого не бачить геокодер: що кав'ярня за
               * цією адресою обслуговується з іншого складу, що сьогодні там
               * ремонт, що клієнт домовився окремо. Переставити його вибір
               * назад означає сперечатися з людиною, яка знає більше.
               */
              if (zone.warehouse && zone.warehouse !== order.warehouse) {
                problems.push(`за адресою вийшов би ${zone.warehouse}, лишаємо обраний`)
              }
            } else if (zone.point?.approximate) {
              problems.push(zone.note ?? 'зона приблизна — перевірте склад')
            } else if (zone.nearMeters && zone.warehouse) {
              /*
               * Зону взято з запасом — склад ставимо, але вголос.
               *
               * Інакше замовлення лишалось би без складу через двісті
               * метрів неточності межі, а так воно їде, і поруч написано,
               * звідки взявся склад.
               */
              if (zone.warehouse !== order.warehouse) {
                patch.warehouse = zone.warehouse
                crm[FIELD.warehouse] = WAREHOUSE_ID[zone.warehouse] ?? ''
                result.rezoned++
              }
              problems.push(zone.note ?? 'зону взято за найближчою межею')
            } else if (zone.warehouse && zone.warehouse !== order.warehouse) {
              patch.warehouse = zone.warehouse
              crm[FIELD.warehouse] = WAREHOUSE_ID[zone.warehouse] ?? ''
              result.rezoned++
            }
          } else if (order.warehouse_pinned && order.warehouse) {
            // Склад уже обрано людиною, тож «оберіть склад вручну» тут
            // не порада, а плутанина: питання не до складу, а до адреси
            problems.push('адреса не впізнана в межах зон — перевірте її написання')
          } else {
            problems.push(zone.note ?? 'зона доставки не визначена')
          }
        } catch (e) {
          if (e instanceof GeocoderUnavailable) {
            result.postponed++
            // Решту проходу теж немає сенсу продовжувати: сервіс той самий
            break
          }
          throw e
        }
      }

      /*
       * Номер із журналу — щойно відома дата.
       *
       * Раніше номер не видавався, якщо огляд знайшов бодай одну хибу, —
       * а найчастіша з них, «період доставки», до ящика не має стосунку
       * зовсім. Замовлення через це доїжджали до «Виконано» без номера:
       * склад збирав ящик, якого немає в журналі. Хиба лишається
       * записаною й видимою, але номер замовлення отримує.
       */
      if (order.manual_number == null && order.delivery_date) {
        /*
         * Імʼя замовлення в журналі — одразу.
         *
         * Доти рядок кілька секунд стояв нічийним, і паралельний прохід
         * устигав забрати той самий номер собі.
         */
        const reserved = await reserveNumber(
          service, order.delivery_date, order.customer_name ?? 'замовлення з сайту',
          order.id,
        )
        if (reserved.source === 'sheet') {
          /**
           * Номер зберігаємо тієї ж миті.
           *
           * У журналі він уже зайнятий — ім'я вписане. Якщо впасти між цим і
           * кінцем обходу, рядок лишиться зайнятим ніким, а наступний прохід
           * візьме наступний номер і так само лишить по собі дірку.
           */
          await service.from('orders')
            .update({ manual_number: reserved.number, number_source: reserved.source })
            .eq('id', order.id)

          // Журнал має знати не лише що номер зайнято, а й ким
          await linkNumber(service, {
            date: order.delivery_date, number: reserved.number, orderId: order.id,
          })

          crm[FIELD.boxNumber] = String(reserved.number)
          result.numbered++
        } else {
          problems.push(reserved.note ?? 'номер із журналу не взявся')
        }
      }

      if (Object.keys(crm).length && order.bitrix_deal_id) {
        await bitrix('crm.deal.update', { id: order.bitrix_deal_id, fields: crm })
      }

      patch.auto_problem = problems.length ? problems.join(', ') : null
      /**
       * Оглянуте більше не переглядаємо — навіть із хибами.
       *
       * Хиба тут здебільшого стала: адреса в селі, якого геокодер не знає,
       * такою й лишиться. Тримати ці замовлення в черзі означало б щоразу
       * впиратись у них і не доходити до нових. Що не склалось, видно
       * оператору написом «потребує уваги», а повторний огляд починає
       * синхронізація, щойно адресу поправлять.
       */
      patch.auto_done_at = new Date().toISOString()

      await service.from('orders').update(patch).eq('id', order.id)
      touched = order.id
      if (problems.length) result.problems++
      else reviewed.push(order.id)
    }

    /*
     * Оглянуте одразу їде на дошку.
     *
     * Склад і період у нього вже є, отже картка може стати в чергу
     * комплектації просто зараз. Чекати на окремий прохід Trello — це
     * три хвилини, протягом яких замовлення лежить у «Нових» і складу
     * невидиме.
     *
     * Невдача тут нічого не ламає: той самий прохід підбере картку
     * пізніше, тому мовчки ловимо помилку й рушаємо далі.
     */
    if (reviewed.length) {
      try {
        const { enrichNewCards } = await import('@/lib/trello-cards')
        const cards = await enrichNewCards(service, { orderIds: reviewed })
        result.carded = cards.moved
      } catch (e) {
        console.error('trello after review:', e instanceof Error ? e.message : e)
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  if (touched) await broadcastOrderChange(touched, 'items')

  // Черга скінчилась — прибираємо позначку, щоб не висіла назавжди
  await service.from('app_settings')
    .upsert({ key: 'autopilot_now', value: null, updated_at: new Date().toISOString() },
      { onConflict: 'key' })
    .then(() => {}, () => {})

  return result
}
