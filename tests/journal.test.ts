import { describe, it, expect, vi } from 'vitest'
import { logOrderEvent } from '@/lib/order-events'

/**
 * Підставна база: запам'ятовує, що саме їй дали вставити.
 *
 * Справжня колонка `actor_id` має тип uuid і порожній рядок у неї не
 * лягає — вставка падала, а `catch` усередині ховав це мовчки. За
 * тиждень у журналі не лишилось жодної автоматичної дії: ні статусів,
 * змінених у CRM, ні нічного закриття дня, ні відправлень на
 * маркетплейс. На питання «хто це зробив» журнал відповідав порожнечею.
 */
function fakeDb() {
  const inserted: Record<string, unknown>[] = []
  const service = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        /* Те саме, що зробив би Postgres: порожній рядок — не uuid */
        if (row.actor_id === '') throw new Error('invalid input syntax for type uuid: ""')
        inserted.push(row)
        return { error: null }
      },
    }),
  }
  return { service, inserted }
}

describe('журнал записує й те, що зробила не людина', () => {
  it('дія без людини лишає запис, а не зникає', async () => {
    const { service, inserted } = fakeDb()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await logOrderEvent(service as any, 'order-1', 'status',
      { old: 'Комплектується', new: 'Скасовано' }, { id: '', name: 'Бітрікс' })

    expect(inserted).toHaveLength(1)
    expect(inserted[0].actor_id).toBeNull()
    expect(inserted[0].actor_name).toBe('Бітрікс')
  })

  it.each(['Бітрікс', 'Закриття дня', 'Мерчант', 'Клієнт (Telegram)'])(
    '«%s» потрапляє в журнал під своїм іменем', async name => {
      const { service, inserted } = fakeDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await logOrderEvent(service as any, 'order-1', 'status', { new: 'Виконано' },
        { id: '', name })
      expect(inserted[0]?.actor_name).toBe(name)
    },
  )

  it('людину записуємо з її номером', async () => {
    const { service, inserted } = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await logOrderEvent(service as any, 'order-1', 'status', { new: 'Спаковано' },
      { id: '04cb7bbb-c576-4427-b866-e944929f800d', name: 'Лев Оля' })

    expect(inserted[0].actor_id).toBe('04cb7bbb-c576-4427-b866-e944929f800d')
  })

  it('без людини зовсім — теж запис, а не тиша', async () => {
    const { service, inserted } = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await logOrderEvent(service as any, 'order-1', 'created', {}, null)

    expect(inserted).toHaveLength(1)
    expect(inserted[0].actor_id).toBeNull()
    expect(inserted[0].actor_name).toBeNull()
  })

  it('журнал не ламає те, про що пише', async () => {
    /* Якщо вставка впала з іншої причини — замовлення вже змінене, і
       кидати звідси помилку означало б відкотити зроблену роботу */
    const service = { from: () => ({ insert: async () => { throw new Error('база лягла') } }) }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(logOrderEvent(service as any, 'order-1', 'status', {}, null))
      .resolves.toBeUndefined()
  })
})
