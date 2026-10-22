/**
 * Періоди доставки такі, якими їх знає Бітрікс.
 *
 * Продаємо ми три вікна — 11-14, 14-17, 17-20, — і саме їх пропонуємо,
 * коли замовлення складає оператор. Але в полі угоди значень шістнадцять:
 * погодинні, «11:00-15:30», «16:00-19:30». Їх ставлять руками, коли з
 * клієнтом домовились окремо.
 *
 * Поки ми знали лише три, решта перетворювалась на «періоду немає» — а це
 * тягнуло за собою все інше: автопілот не видавав номер ящика, картка не
 * їхала з «Нових замовлень» у комплектацію, і замовлення доїжджало до
 * «Виконано» без номера. Одне невідоме значення коштувало всього ланцюга.
 *
 * Тому читаємо будь-яке значення поля, а чого не знаємо напам'ять —
 * питаємо в самого Бітрікса й запам'ятовуємо.
 */
import { bitrix } from '@/lib/bitrix'

/** Поле «період доставки» в угоді */
export const SLOT_FIELD = 'UF_CRM_1606047143435'

/**
 * Те, що Бітрікс віддає сьогодні.
 *
 * Список статичний навмисне: він відповідає на питання без мережі, а
 * мережу питаємо лише про те, чого тут немає.
 */
const KNOWN: Record<string, string> = {
  26: '11:00-14:00',
  27: '14:00-17:00',
  345: '17:00-20:00',
  391: '09:00-10:00',
  392: '10:00-11:00',
  393: '11:00-12:00',
  397: '12:00-13:00',
  398: '13:00-14:00',
  399: '14:00-15:00',
  400: '15:00-16:00',
  401: '16:00-17:00',
  402: '17:00-18:00',
  421: '18:00-23:00',
  447: '14:01-17:01',
  448: '11:00-15:30',
  449: '16:00-19:30',
}

/**
 * «9:00 - 10:00 » → «09:00-10:00».
 *
 * Пробіли навколо тире, зайвий пробіл у кінці й година без нуля — це
 * три написання того самого періоду. Якби вони лишались різними, той
 * самий період у двох замовленнях не збігся б ні в фільтрі, ні на дошці.
 */
export function normalizeSlot(raw: string): string {
  const m = raw.trim().match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/)
  if (!m) return raw.trim()
  const pad = (h: string) => h.padStart(2, '0')
  return `${pad(m[1])}:${m[2]}-${pad(m[3])}:${m[4]}`
}

/** Те, що довелось питати в Бітрікса, — на час життя процесу */
const learned = new Map<string, string>()
let fetched = false

async function learn(): Promise<void> {
  if (fetched) return
  fetched = true

  try {
    const fields = await bitrix<{ LIST?: { ID: string; VALUE: string }[] }[]>(
      'crm.deal.userfield.list', { filter: { FIELD_NAME: SLOT_FIELD } },
    )
    for (const field of fields ?? []) {
      for (const item of field.LIST ?? []) {
        learned.set(String(item.ID), normalizeSlot(item.VALUE))
      }
    }
  } catch {
    /*
     * Не дізнались — не страшно.
     *
     * Відомі значення працюють і без цього запиту, а невідоме так само
     * лишиться невідомим, як було до спроби. Валити через це всю
     * синхронізацію означало б проміняти одне поле на всі замовлення.
     */
  }
}

/** Підпис періоду за значенням поля угоди, або null якщо поле порожнє */
export async function slotLabel(id: string | null | undefined): Promise<string | null> {
  const key = String(id ?? '').trim()
  if (!key || key === '0') return null

  if (KNOWN[key]) return KNOWN[key]
  if (learned.has(key)) return learned.get(key) as string

  await learn()
  return learned.get(key) ?? null
}

/** Значення поля за підписом — щоб записати період назад в угоду */
export async function slotId(label: string | null | undefined): Promise<number | ''> {
  const want = normalizeSlot(String(label ?? ''))
  if (!want) return ''

  for (const [id, text] of Object.entries(KNOWN)) if (text === want) return Number(id)

  await learn()
  for (const [id, text] of learned) if (text === want) return Number(id)

  return ''
}

/** Початок періоду у хвилинах від опівночі — щоб знайти йому місце */
export function slotStartMinutes(label: string): number | null {
  const m = normalizeSlot(label).match(/^(\d{2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
