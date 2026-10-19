/**
 * Стадії воронки «Замовлення з НОВОГО САЙТУ».
 *
 * Для замовлень із сайту й телефону статус — це стадія угоди в Бітріксі, а
 * не наш власний словник: в CRM із ними працюють оператори, і дві різні
 * назви одного стану означали б, що про замовлення не домовитись словами.
 *
 * Коди й назви розходяться — воронку зібрали з типових стадій і
 * перейменували, тож «Комплектується» має код рахунку-передоплати. Тому
 * ніде не здогадуємось, а звіряємось із цією таблицею.
 */
export const BITRIX_STAGES: { id: string; name: string }[] = [
  { id: 'C1:NEW',                name: 'Очікування оплати' },
  { id: 'C1:PREPARATION',        name: 'В обробці' },
  { id: 'C1:PREPAYMENT_INVOICE', name: 'Комплектується' },
  { id: 'C1:FINAL_INVOICE',      name: 'Спаковано' },
  { id: 'C1:1',                  name: 'В дорозі' },
  { id: 'C1:EXECUTING',          name: 'В обробці (списано кошти)' },
  { id: 'C1:2',                  name: 'ПЕРЕДЗАМОВЛЕННЯ' },
  { id: 'C1:WON',                name: 'Виконано' },
  { id: 'C1:LOSE',               name: 'Скасовано' },
  { id: 'C1:APOLOGY',            name: 'Повернено' },
  { id: 'C1:UC_1AEF1N',          name: 'Не вдалося' },
]

export const STAGE_NAMES = BITRIX_STAGES.map(s => s.name)

const byId = new Map(BITRIX_STAGES.map(s => [s.id, s.name]))
const byName = new Map(BITRIX_STAGES.map(s => [s.name, s.id]))

export const stageName = (id: string | null | undefined) => byId.get(id ?? '') ?? null
export const stageId = (name: string | null | undefined) => byName.get(name ?? '') ?? null

/** Замовлення ще в роботі — його видно у вкладці «У роботі». */
export const OPEN_STAGES = [
  'Очікування оплати', 'В обробці', 'Комплектується', 'Спаковано',
  'В обробці (списано кошти)', 'ПЕРЕДЗАМОВЛЕННЯ',
]

/** Віддано кур'єру. */
export const SHIPPING_STAGE = 'В дорозі'

/** Більше нічого не буде — ні збирати, ні везти. */
export const CLOSED_STAGES = ['Виконано', 'Скасовано', 'Повернено', 'Не вдалося']
