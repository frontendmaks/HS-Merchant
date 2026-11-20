import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/*
 * Дубль замовлення з сайту.
 *
 * 20 листопада сайт прийняв один кошик двічі: замовлення 968429 і 968430
 * народились із різницею в секунду — той самий телефон, той самий iPhone,
 * та сама адреса. Для нас це дві угоди, два ящики й оператор, який мусить
 * здогадатись, котре з двох справжнє.
 *
 * Відбиток кошика — єдине місце, де цей збіг не здогад: WooCommerce рахує
 * його зі вмісту, і два замовлення з одним відбитком були одним кошиком.
 */

const ENV = { WC_URL: 'https://example.test', WC_CONSUMER_KEY: 'ck', WC_CONSUMER_SECRET: 'cs' }

async function load() {
  vi.resetModules()
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  return await import('@/lib/wc-order')
}

const order = (id: number, deal: string | null, hash: string | null) => ({
  id,
  cart_hash: hash,
  meta_data: deal == null ? [] : [{ key: 'crm_deal_id', value: deal }],
})

function respond(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch
}

let fetchWas: typeof fetch

beforeEach(() => { fetchWas = globalThis.fetch })
afterEach(() => { globalThis.fetch = fetchWas; vi.restoreAllMocks() })

describe('відбиток кошика з сайту', () => {
  it('два замовлення одного кошика дають один відбиток', async () => {
    globalThis.fetch = respond([
      order(968429, '202957', '2ecbf55b273cd42ddf23bea3e45668fc'),
      order(968430, '202958', '2ecbf55b273cd42ddf23bea3e45668fc'),
    ])
    const { wcCartHashes } = await load()
    const hashes = await wcCartHashes([202957, 202958])
    expect(hashes.get(202957)).toBe(hashes.get(202958))
    expect(hashes.size).toBe(2)
  })

  it('різні кошики — різні відбитки, і ми нічого не доводимо', async () => {
    globalThis.fetch = respond([
      order(968429, '202957', 'aaa'),
      order(968430, '202958', 'bbb'),
    ])
    const { wcCartHashes } = await load()
    const hashes = await wcCartHashes([202957, 202958])
    expect(hashes.get(202957)).not.toBe(hashes.get(202958))
  })

  /*
   * Сайт відповідає 403 всьому, що не схоже на браузер. Доти ця відмова
   * виглядала як «замовлень немає» — і добір позицій мовчки не працював.
   */
  it('запит іде з браузерним представленням', async () => {
    const spy = respond([])
    globalThis.fetch = spy
    const { wcCartHashes } = await load()
    await wcCartHashes([202957])
    const init = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(String((init.headers as Record<string, string>)['User-Agent'])).toMatch(/Mozilla/)
  })

  it('мовчання сайту не доводить нічого', async () => {
    globalThis.fetch = respond('Forbidden', false)
    const { wcCartHashes } = await load()
    expect((await wcCartHashes([202957, 202958])).size).toBe(0)
  })

  it('замовлення без номера угоди нас не обходять', async () => {
    globalThis.fetch = respond([
      order(968398, null, 'fa6da0a3c9ee03d26d04ca631aed9d3a'),
      order(968399, '202913', 'fa6da0a3c9ee03d26d04ca631aed9d3a'),
    ])
    const { wcCartHashes } = await load()
    const hashes = await wcCartHashes([202913])
    expect([...hashes.keys()]).toEqual([202913])
  })

  it('чужі угоди в відповідь не потрапляють', async () => {
    globalThis.fetch = respond([
      order(968430, '202958', 'hash-1'),
      order(968500, '203100', 'hash-2'),
    ])
    const { wcCartHashes } = await load()
    expect([...(await wcCartHashes([202958])).keys()]).toEqual([202958])
  })

  it('порожній відбиток не вважається доказом', async () => {
    globalThis.fetch = respond([
      order(968429, '202957', ''),
      order(968430, '202958', ''),
    ])
    const { wcCartHashes } = await load()
    expect((await wcCartHashes([202957, 202958])).size).toBe(0)
  })
})
