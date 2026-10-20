/**
 * Слід від кожного проходу розкладу.
 *
 * Без нього «чи працює синхронізація» перевіряється лише здогадом: якщо в
 * замовленнях нічого не змінилось, незрозуміло, чи то в CRM нічого не
 * ставалось, чи то прохід не відбувся. Запис розрізняє ці два випадки — і
 * саме його видно в інтерфейсі як «востаннє перевіряли N хвилин тому».
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export async function logCronRun(
  service: Service,
  name: string,
  startedAt: number,
  result: unknown,
  error?: string,
): Promise<void> {
  try {
    await service.from('cron_runs').insert({
      name,
      duration_ms: Date.now() - startedAt,
      result: result ?? null,
      error: error ?? null,
    })
    // Прибираємо старе зрідка: тиждень записів кожні три хвилини — це
    // три тисячі рядків, і без чистки вони лишались би назавжди
    if (Math.random() < 0.01) await service.rpc('prune_cron_runs')
  } catch {
    // Журнал не має ламати те, про що він пише
  }
}

export async function lastCronRun(
  service: Service,
  name: string,
): Promise<{ ran_at: string; result: unknown; error: string | null } | null> {
  const { data } = await service
    .from('cron_runs')
    .select('ran_at, result, error')
    .eq('name', name)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ?? null
}
