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
import { reserveNumber } from '@/lib/manual-register'
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
}

export interface AutopilotResult {
  looked: number
  numbered: number
  rezoned: number
  problems: number
  /** Замовлення, відкладені через мовчання геокодера */
  postponed: number
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

export async function autoProcessSiteOrders(
  service: Service,
  { limit = 50, orderIds }: { limit?: number; orderIds?: string[] } = {},
): Promise<AutopilotResult> {
  const result: AutopilotResult = {
    looked: 0, numbered: 0, rezoned: 0, problems: 0, postponed: 0,
  }
  // Одне сповіщення наприкінці — див. те саме міркування в синхронізації
  let touched: string | null = null

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
      .select('id, external_id, bitrix_deal_id, customer_name, customer_phone, address, warehouse, warehouse_pinned, delivery_zone, delivery_date, delivery_slot, manual_number, number_source, status')
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
          const zone = await resolveAddress(service, order.address)
          // Район або село — для аналітики доставок
          patch.area = areaFromDisplay(zone.point?.display_name) ?? null

          if (zone.zone) {
            patch.delivery_zone = zone.zone

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

      // Номер із журналу — тільки якщо його ще немає й дата відома
      if (order.manual_number == null && order.delivery_date && !problems.length) {
        const reserved = await reserveNumber(
          service, order.delivery_date, order.customer_name ?? 'замовлення з сайту',
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
