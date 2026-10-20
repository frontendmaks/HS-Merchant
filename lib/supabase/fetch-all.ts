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
  const all: T[] = []

  for (let batch = 0; ; batch++) {
    const offsets = Array.from({ length: parallel }, (_, i) => (batch * parallel + i) * pageSize)
    const pages = await Promise.all(offsets.map(async offset => {
      const { data, error } = await makeQuery().range(offset, offset + pageSize - 1)
      if (error) throw error
      return data ?? []
    }))

    for (const page of pages) all.push(...page)

    // Коротка сторінка означає кінець: далі порожньо
    if (pages.some(page => page.length < pageSize)) break
  }

  return all
}
