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
): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}
