/** Bound outbound waits; callers still receive the original failure. */
export function timedFetch(timeoutMs: number): typeof fetch {
  return (input, init) => fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  })
}

export async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Сервіс тимчасово не відповідає. Спробуйте ще раз')), ms)
    })])
  } finally { clearTimeout(timer) }
}
