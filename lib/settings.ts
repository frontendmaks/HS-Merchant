/**
 * Налаштування, які міняють люди.
 *
 * Деякі числа в системі належать не програмі, а роботі: скільки хвилин до
 * початку періоду ще можна прийняти замовлення — це про те, як сьогодні
 * їздять, і міняти його має бути можна без випуску нової версії.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export const DEFAULTS = {
  /** Скільки хвилин до початку періоду він ще приймає замовлення */
  delivery_buffer_minutes: 20,
  /** Самостійне опрацювання замовлень із сайту */
  auto_process_site_orders: true,
  /**
   * Самостійне опрацювання маркетплейсних замовлень.
   *
   * Вимкнене за замовчуванням: прийняти замовлення на майданчику — це
   * обіцянка покупцеві, і вмикати її має людина.
   */
  marketplace_autoprocess: false,
  /** З якого складу відвантажують маркетплейсні замовлення */
  marketplace_warehouse: 'Гуртівня онлайн' as string,
} as const

export type SettingKey = keyof typeof DEFAULTS

export async function getSetting<K extends SettingKey>(
  service: Service,
  key: K,
): Promise<typeof DEFAULTS[K]> {
  const { data } = await service.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (data?.value === undefined || data?.value === null) return DEFAULTS[key]
  return data.value as typeof DEFAULTS[K]
}

export async function getSettings(
  service: Service,
): Promise<typeof DEFAULTS> {
  const { data } = await service.from('app_settings').select('key, value')
  const out = { ...DEFAULTS } as Record<string, unknown>
  for (const row of data ?? []) {
    if (row.key in DEFAULTS && row.value != null) out[row.key as string] = row.value
  }
  return out as typeof DEFAULTS
}

export async function setSetting(
  service: Service,
  key: SettingKey,
  value: unknown,
  by?: string,
): Promise<void> {
  await service.from('app_settings').upsert({
    key, value, updated_at: new Date().toISOString(), updated_by: by ?? null,
  }, { onConflict: 'key' })
}
