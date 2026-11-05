/**
 * PostgREST caps every response at `max-rows` (1000 by default), silently
 * truncating results even when `.limit(5000)` is requested. Any query that can
 * return more than 1000 rows must page through with `.range()` instead.
 */

const PAGE_SIZE = 1000

type QueryBuilder<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

/**
 * Fetch every row of a query by paging through it.
 *
 * @param makeQuery called once per page — must return a fresh builder, since a
 *                  PostgREST builder can only be awaited once.
 */
export async function fetchAllRows<T>(
  makeQuery: () => QueryBuilder<T>,
  pageSize = PAGE_SIZE,
  /**
   * Скільки сторінок брати одночасно.
   *
   * Сторінки незалежні одна від одної, а кожна — окрема подорож до бази.
   * Тридцять тисяч рядків по одній сторінці за раз це тридцять подорожей
   * поспіль; по чотири — вісім. Для аналітики за рік це різниця між
   * «відкрилось» і «зависло».
   */
  parallel = 4,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(parallel) || parallel < 1) {
    throw new Error('Invalid pagination settings')
  }
  const first = await makeQuery().range(0, pageSize - 1)
  if (first.error) throw first.error
  const all: T[] = first.data ?? []
  if (all.length < pageSize) return all
  for (let offset = pageSize; ; offset += parallel * pageSize) {
    const pages = await Promise.all(Array.from({ length: parallel }, async (_, i) => {
      const r = await makeQuery().range(offset + i * pageSize, offset + (i + 1) * pageSize - 1)
      if (r.error) throw r.error
      return r.data ?? []
    }))
    for (const page of pages) all.push(...page)
    if (pages.some(page => page.length < pageSize)) return all
  }
}
