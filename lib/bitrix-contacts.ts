/**
 * Клієнти з CRM.
 *
 * Сорок сім тисяч контактів, і більшість із них наших замовлень ще не
 * робила: вони купували до того, як з'явився Мерчант, або на касі. Оператор
 * має впізнавати їх так само, як постійних — тому забираємо всіх, а не лише
 * тих, хто є в наших замовленнях.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

interface Contact {
  ID: string
  NAME: string | null
  LAST_NAME: string | null
  SECOND_NAME: string | null
  PHONE?: { VALUE: string }[]
}

const FIELDS = ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE']

/** Скільки сторінок по 50 беремо однією пачкою. */
const PER_BATCH = 50

export interface ImportResult {
  read: number
  saved: number
  next: number | null
  total?: number
  error?: string
}

/**
 * Забирає сторінку контактів і складає їх у базу клієнтів.
 *
 * Бере за раз дві з половиною тисячі — пачкою з п'ятдесяти запитів. Поодинці
 * це була б тисяча звернень на один повний імпорт.
 */
export async function importContacts(
  service: Service,
  start = 0,
): Promise<ImportResult> {
  try {
    const cmd: Record<string, string> = {}
    for (let i = 0; i < PER_BATCH; i++) {
      const offset = start + i * 50
      cmd[`p${i}`] = `crm.contact.list?${
        FIELDS.map(f => `select[]=${f}`).join('&')
      }&order[ID]=ASC&start=${offset}`
    }

    const res = await bitrix<{ result: Record<string, Contact[]> }>('batch', { halt: 0, cmd })
    const pages = Object.values(res?.result ?? {})
    const contacts = pages.flat()

    const rows = new Map<string, {
      phone_key: string; phone: string; names: string[]; phones: string[]
      bitrix_contact_id: number; search: string
    }>()

    for (const c of contacts) {
      const phones = (c.PHONE ?? []).map(p => p.VALUE?.trim()).filter(Boolean) as string[]
      const key = phoneKey(phones[0])
      // Без телефону клієнта не впізнати — а саме за ним його й шукають
      if (!key) continue

      const name = [c.LAST_NAME, c.NAME, c.SECOND_NAME]
        .map(x => x?.trim()).filter(Boolean).join(' ')

      const existing = rows.get(key)
      const names = [...new Set([...(existing?.names ?? []), ...(name ? [name] : [])])]
      const allPhones = [...new Set([...(existing?.phones ?? []), ...phones])]

      rows.set(key, {
        phone_key: key,
        phone: phones[0],
        names,
        phones: allPhones,
        bitrix_contact_id: Number(c.ID),
        search: [...names, ...allPhones.map(p => p.replace(/\D/g, ''))]
          .join(' ').toLowerCase(),
      })
    }

    const list = [...rows.values()]
    if (list.length) {
      // Порціями: один запит на дві тисячі рядків база приймає, на двадцять
      // тисяч — уже ні
      for (let i = 0; i < list.length; i += 500) {
        await service.rpc('merge_customers_from_crm', {
          payload: list.slice(i, i + 500),
        })
      }
    }

    // Коротша за очікувану відповідь означає, що контакти скінчились
    const full = pages.length === PER_BATCH && pages.every(p => p.length === 50)

    return {
      read: contacts.length,
      saved: list.length,
      next: full ? start + PER_BATCH * 50 : null,
    }
  } catch (e) {
    return { read: 0, saved: 0, next: null, error: e instanceof Error ? e.message : String(e) }
  }
}
