/**
 * Під'єднані сервіси.
 *
 * Частина інтеграцій живе у змінних оточення — їх ставив розробник, і
 * міняти їх з інтерфейсу не можна й не треба. Частину під'єднує сам
 * власник: вставив токен, перевірили, працює.
 *
 * Сторінка показує і ті, і ті. Інакше виходить напівправда: половина
 * зв'язків є, але де вони й чи живі — ніде не видно.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export type Managed = 'env' | 'panel'

export interface Connector {
  key: string
  title: string
  what: string
  managed: Managed
  /** Що саме вставляє власник, коли під'єднує сам */
  fields?: { name: string; label: string; hint?: string; secret?: boolean }[]
  /** Для тих, що зі змінних: чи вони налаштовані */
  present?: () => boolean
}

export const CONNECTORS: Connector[] = [
  {
    key: 'viber',
    title: 'Viber',
    what: 'Сповіщення клієнтові про його замовлення',
    managed: 'panel',
    fields: [
      {
        name: 'token',
        label: 'Токен публічного акаунта',
        hint: 'Viber → Admin Panel вашого публічного акаунта → Edit Info → Token',
        secret: true,
      },
    ],
  },
  {
    key: 'telegram',
    title: 'Telegram',
    what: 'Те саме, але для тих, хто не користується Viber',
    managed: 'panel',
    fields: [
      { name: 'token', label: 'Токен бота', hint: 'Від @BotFather', secret: true },
    ],
  },
  {
    key: 'bitrix',
    title: 'Бітрікс24',
    what: 'Угоди, статуси, чати складів — основа роботи',
    managed: 'env',
    present: () => !!process.env.BITRIX_WEBHOOK_URL,
  },
  {
    key: 'trello',
    title: 'Trello',
    what: 'Номер ящика й бланк у картках дошки доставки',
    managed: 'env',
    present: () => !!process.env.TRELLO_KEY && !!process.env.TRELLO_TOKEN,
  },
  {
    key: 'sheets',
    title: 'Google Таблиці',
    what: 'Журнал номерів ящиків, за яким працює склад',
    managed: 'env',
    present: () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      || !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  },
]

export interface IntegrationRow {
  key: string
  enabled: boolean
  config: Record<string, unknown>
  status: string | null
  checked_at: string | null
}

export async function loadIntegrations(service: Service): Promise<Map<string, IntegrationRow>> {
  const { data } = await service
    .from('integrations').select('key, enabled, config, status, checked_at')

  return new Map((data ?? []).map(r => [r.key as string, r as unknown as IntegrationRow]))
}

export async function integrationConfig<T = Record<string, unknown>>(
  service: Service,
  key: string,
): Promise<T | null> {
  const { data } = await service
    .from('integrations').select('config, enabled').eq('key', key).maybeSingle()

  if (!data?.enabled) return null
  return (data.config ?? {}) as T
}

export async function saveIntegration(
  service: Service,
  key: string,
  patch: Partial<IntegrationRow>,
): Promise<void> {
  await service.from('integrations').upsert({
    key,
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
}

/**
 * Токен у вигляді, придатному для показу.
 *
 * Повертати його цілком на сторінку не можна: сторінку видно всім, хто
 * має доступ до вкладки, а токен відкриває чужий сервіс від нашого імені.
 */
export const maskSecret = (value: unknown): string | null => {
  const s = typeof value === 'string' ? value : ''
  if (!s) return null
  return s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-4)}`
}
