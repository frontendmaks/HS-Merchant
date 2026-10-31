import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Гальмо тестового середовища.
 *
 * Це найдорожчий тест у наборі: якщо гальмо колись відпустить, перша ж
 * перевірка нового коду заведе справжню угоду й надішле справжній бланк
 * на склад — комірник піде збирати вигадане замовлення.
 *
 * Мережі тут немає навмисно: `fetch` підмінений і має не викликатись
 * жодного разу. Виклик, який до нього дійшов, — це виклик, який у житті
 * дійшов би до Бітрікса.
 */

const realEnv = process.env.MERCHANT_ENV
const realHook = process.env.BITRIX_WEBHOOK_URL

beforeEach(() => {
  vi.resetModules()
  process.env.BITRIX_WEBHOOK_URL = 'https://nowhere.invalid/rest/1/x'
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('вийшло в мережу — гальмо не спрацювало')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (realEnv === undefined) delete process.env.MERCHANT_ENV
  else process.env.MERCHANT_ENV = realEnv
  if (realHook === undefined) delete process.env.BITRIX_WEBHOOK_URL
  else process.env.BITRIX_WEBHOOK_URL = realHook
})

describe('у тестовому режимі назовні не йде нічого', () => {
  const writes: [string, Record<string, unknown>][] = [
    ['crm.deal.add', { fields: { TITLE: 'тест' } }],
    ['crm.deal.update', { id: 1, fields: {} }],
    ['crm.deal.productrows.set', { id: 1, rows: [] }],
    ['crm.contact.add', { fields: {} }],
    ['crm.contact.update', { id: 1, fields: {} }],
    ['im.message.add', { DIALOG_ID: 'chat1', MESSAGE: 'бланк' }],
    ['crm.deal.delete', { id: 1 }],
  ]

  it.each(writes)('%s не доходить до мережі', async (method, params) => {
    process.env.MERCHANT_ENV = 'test'
    const { bitrix } = await import('@/lib/bitrix')

    await expect(bitrix(method, params)).resolves.toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('заведення повертає впізнаваний вигаданий номер, а не справжній', async () => {
    process.env.MERCHANT_ENV = 'test'
    const { bitrix } = await import('@/lib/bitrix')

    const id = await bitrix<number>('crm.deal.add', { fields: {} })
    /* Щоб ланцюжок перевірявся далі — номер ящика, бланк, картка, — але
       щоб такий номер ніколи не сплутали зі справжньою угодою */
    expect(id).toBeGreaterThanOrEqual(9_000_000)
  })

  it('читання не гальмуємо — без нього тестувати нема на чому', async () => {
    process.env.MERCHANT_ENV = 'test'
    const { bitrix } = await import('@/lib/bitrix')

    await expect(bitrix('crm.deal.get', { ID: 1 })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('у продакшні гальма немає', () => {
  it('запис іде в мережу, як і раніше', async () => {
    delete process.env.MERCHANT_ENV
    const { bitrix } = await import('@/lib/bitrix')

    await expect(bitrix('crm.deal.add', { fields: {} })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
