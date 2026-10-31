/**
 * Стан системи однією сторінкою.
 *
 * Доти «чи все працює» з'ясовувалось тільки через людей: комірник не
 * дочекався бланка, оператор побачив штуки замість кілограмів, хтось
 * помітив, що замовлення в CRM є, а в Мерчанті немає. Кожну таку річ
 * видно й у базі — за кілька годин до того, як про неї скажуть уголос.
 *
 * Тут дві половини, і вони відповідають на різні питання.
 *
 * Розклади кажуть, **чи система взагалі жива**: прохід, який мав бути три
 * хвилини тому й не був, — це те, через що замовлення стоять без складу,
 * без номера й без бланка. Тиша тут страшніша за помилку: помилку видно,
 * а мовчання виглядає як спокій.
 *
 * Перевірки замовлень кажуть, **що саме зараз зламане**: не «скільки
 * помилок», а які замовлення і що з ними робити. Кожна перевірка — це те,
 * що хтось інакше знайшов би руками.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

/**
 * Розклади, яких ми чекаємо.
 *
 * `everyMinutes` — із vercel.json. За ним рахується прострочення: прохід,
 * якого немає вчетверо довше за його такт, уже не «щойно не встиг».
 */
export interface Job {
  name: string
  label: string
  everyMinutes: number
  /** Що зупиняється разом із ним — щоб не гадати, чим це загрожує */
  costs: string
}

/**
 * Нуль — це «не за розкладом, а за подією».
 *
 * Вхідний вебхук Бітрікса приходить тоді, коли там щось сталося. Уночі не
 * стається нічого, і міряти його тактом означало б щоранку бачити червоне
 * там, де все гаразд. Його тиша теж буває красномовна, але судити про неї
 * має людина, а не формула.
 */
const BY_EVENT = 0

export const JOBS: Job[] = [
  { name: 'bitrix-event', label: 'Вхідні події з Бітрікса', everyMinutes: BY_EVENT,
    costs: 'зміни з CRM доходять не одразу, а найближчим проходом' },
  { name: 'bitrix-sync', label: 'Замовлення з Бітрікса', everyMinutes: 3,
    costs: 'нові замовлення не з\'являються, зміни статусів не доходять' },
  { name: 'site-autopilot', label: 'Огляд замовлень із сайту', everyMinutes: 3,
    costs: 'замовлення лишаються без зони, складу й номера ящика' },
  { name: 'trello-cards', label: 'Картки на дошці', everyMinutes: 3,
    costs: 'кур\'єри не бачать нових замовлень на дошці' },
  { name: 'marketplace-autopilot', label: 'Замовлення з маркетплейсів', everyMinutes: 5,
    costs: 'замовлення з MauDau і Rozetka не доходять до CRM' },
  { name: 'customer-notify', label: 'Повідомлення клієнтам', everyMinutes: 5,
    costs: 'клієнт не дізнається, що його замовлення збирають' },
  { name: 'webhooks', label: 'Вебхуки інтеграцій', everyMinutes: 5,
    costs: 'сторонні системи не отримують наших подій' },
  { name: 'mp-sync-quick', label: 'Маркетплейси: швидкий прохід', everyMinutes: 5,
    costs: 'ТТН і статуси з майданчиків застарівають' },
  { name: 'delivery-notify', label: 'Доставка: нагадування', everyMinutes: 15,
    costs: 'клієнт не отримує нагадування про привезення' },
  { name: 'bitrix-check', label: 'Звірка з Бітріксом', everyMinutes: 60,
    costs: 'розбіжності між CRM і Мерчантом нікому не видно' },
  { name: 'mp-sync', label: 'Маркетплейси: повний прохід', everyMinutes: 1440,
    costs: 'старі замовлення майданчиків не перечитуються' },
  { name: 'wc-catalog', label: 'Каталог із сайту', everyMinutes: 1440,
    costs: 'ціни й залишки в Мерчанті відстають від сайту' },
  { name: 'customers', label: 'База клієнтів', everyMinutes: 1440,
    costs: 'нові контакти з CRM не підтягуються' },
  { name: 'zones', label: 'Карта зон (буденна)', everyMinutes: 1440,
    costs: 'склад визначається за застарілими межами' },
  { name: 'zones-sunday', label: 'Карта зон (недільна)', everyMinutes: 1440,
    costs: 'у неділю склад визначається за буденною картою' },
  { name: 'bitrix-catalog', label: 'Каталог Бітрікса', everyMinutes: 1440,
    costs: 'позиції не знаходять свого товару — 1С бачить порожні поля' },
  { name: 'price-monitor', label: 'Моніторинг цін', everyMinutes: 1440,
    costs: 'розбіжності цін з конкурентами не збираються' },
  { name: 'close-day', label: 'Закриття дня', everyMinutes: 1440,
    costs: 'невиконані замовлення не закриваються ввечері' },
]

export interface JobState extends Job {
  ranAt: string | null
  durationMs: number | null
  error: string | null
  /** Скільки хвилин тому був останній прохід */
  agoMinutes: number | null
  /** Невдалих проходів за добу */
  failed24h: number
  runs24h: number
  state: 'ok' | 'late' | 'failing' | 'silent'
}

/**
 * Прострочення рахуємо з запасом утричі.
 *
 * Прохід, який іде що три хвилини, легко може спізнитись на хвилину —
 * черга на Vercel, довгий попередній запуск. Бити на сполох через це
 * означало б привчити не дивитись на цю сторінку взагалі. А ось коли
 * трихвилинного немає десять хвилин — це вже не затримка.
 */
const LATE_FACTOR = 3
/** Добовому проходу дозволяємо лише півдня запасу: втричі — це три дні */
const lateAfter = (everyMinutes: number) =>
  everyMinutes >= 720 ? everyMinutes + 720 : everyMinutes * LATE_FACTOR

export async function cronHealth(service: Service): Promise<JobState[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  /* Беремо добу одним запитом, а не останній запис на кожен розклад:
     сімнадцять запитів поспіль коштували б більше, ніж уся сторінка */
  const { data } = await service
    .from('cron_runs')
    .select('name, ran_at, duration_ms, error')
    .gte('ran_at', since)
    .order('ran_at', { ascending: false })
    .limit(5000)

  const runs = data ?? []
  const now = Date.now()

  return JOBS.map(job => {
    const own = runs.filter(r => r.name === job.name)
    const last = own[0]
    const failed24h = own.filter(r => r.error).length
    const agoMinutes = last
      ? Math.round((now - new Date(last.ran_at as string).getTime()) / 60000)
      : null

    /*
     * Чотири стани, і «мовчить» — окремо від «спізнюється».
     *
     * Розклад, від якого за добу не було жодного сліду, — це або щойно
     * доданий запис у журналі, або справді вимкнений прохід. Показувати
     * його як «спізнився на 1440 хвилин» означало б збрехати про
     * точність: ми просто не знаємо, коли він був востаннє.
     */
    const state: JobState['state'] =
      !last ? 'silent'
        : last.error ? 'failing'
          : job.everyMinutes !== BY_EVENT
            && agoMinutes != null && agoMinutes > lateAfter(job.everyMinutes) ? 'late'
            : 'ok'

    return {
      ...job,
      ranAt: (last?.ran_at as string) ?? null,
      durationMs: (last?.duration_ms as number) ?? null,
      error: (last?.error as string) ?? null,
      agoMinutes,
      failed24h,
      runs24h: own.length,
      state,
    }
  })
}

/** Остання помилка кожного розкладу за добу — коротким списком */
export async function recentFailures(service: Service, limit = 20): Promise<{
  name: string; ran_at: string; error: string
}[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await service
    .from('cron_runs')
    .select('name, ran_at, error')
    .not('error', 'is', null)
    .gte('ran_at', since)
    .order('ran_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as { name: string; ran_at: string; error: string }[]
}

export interface Check {
  key: string
  label: string
  /** Чому це погано — мовою наслідку, а не поля в базі */
  why: string
  count: number
  /** Номери замовлень, щоб було з чого почати */
  sample: string[]
  severity: 'bad' | 'warn'
  href: string
}

const PICKING = 'Комплектується'
const PACKED = 'Спаковано'

/**
 * Перевірки живих замовлень.
 *
 * Дивимось лише на сьогодні й далі: вчорашнє замовлення без зони вже
 * нікому не зашкодить, а в списку воно витіснило б те, що везуть зараз.
 */
export async function orderChecks(service: Service): Promise<Check[]> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })
  const SITE = ['site', 'manual']

  const label = (o: { manual_number: number | null; external_id: string | null }) =>
    o.manual_number != null ? `№${o.manual_number}` : (o.external_id ?? '—')

  const pick = (rows: unknown[] | null) =>
    (rows ?? []).slice(0, 6).map(r => label(r as never))

  /* `count: 'exact'` — бо PostgREST мовчки віддає перші тисячу рядків, і
     без нього «1000» означало б і тисячу, і десять тисяч */
  const base = () => service
    .from('orders')
    .select('manual_number, external_id', { count: 'exact' })
    .gte('delivery_date', today)
    .not('status', 'in', '("Скасовано","Виконано")')

  const [noSheet, crmError, chatError, noWarehouse, noDeal, noNumber, noZone] =
    await Promise.all([
      base().in('platform', SITE).in('status', [PICKING, PACKED]).is('chat_sent_at', null),
      base().not('bitrix_error', 'is', null),
      base().not('chat_error', 'is', null),
      base().or('warehouse.is.null,warehouse.eq.'),
      base().in('platform', SITE).is('bitrix_deal_id', null),
      base().in('platform', SITE).in('status', [PICKING, PACKED]).is('manual_number', null),
      base().in('platform', SITE).is('delivery_zone', null),
    ])

  const checks: Check[] = [
    {
      key: 'no-sheet', label: 'На комплектації без бланка',
      why: 'склад про замовлення не знає й не збирає його',
      count: noSheet.count ?? noSheet.data?.length ?? 0, sample: pick(noSheet.data),
      severity: 'bad', href: '/orders/site',
    },
    {
      key: 'crm-error', label: 'Не дійшли до Бітрікса',
      why: 'замовлення є в Мерчанті, але 1С його не забере',
      count: crmError.count ?? crmError.data?.length ?? 0, sample: pick(crmError.data),
      severity: 'bad', href: '/orders/site',
    },
    {
      key: 'no-deal', label: 'Без угоди в CRM',
      why: 'те саме: накладної на таке замовлення не буде',
      count: noDeal.count ?? noDeal.data?.length ?? 0, sample: pick(noDeal.data),
      severity: 'bad', href: '/orders/site',
    },
    {
      key: 'no-warehouse', label: 'Без складу',
      why: 'невідомо, звідки везти — бланк нікуди не піде',
      count: noWarehouse.count ?? noWarehouse.data?.length ?? 0, sample: pick(noWarehouse.data),
      severity: 'bad', href: '/orders/site',
    },
    {
      key: 'no-number', label: 'На комплектації без номера ящика',
      why: 'комірник не знає, в який ящик складати',
      count: noNumber.count ?? noNumber.data?.length ?? 0, sample: pick(noNumber.data),
      severity: 'bad', href: '/orders/numbers',
    },
    {
      key: 'chat-error', label: 'Бланк не надіслався',
      why: 'чат складу не відповів — бланк треба переслати руками',
      count: chatError.count ?? chatError.data?.length ?? 0, sample: pick(chatError.data),
      severity: 'warn', href: '/orders/site',
    },
    {
      key: 'no-zone', label: 'Без зони доставки',
      why: 'адресу не впізнав геокодер; склад міг стати не той',
      count: noZone.count ?? noZone.data?.length ?? 0, sample: pick(noZone.data),
      severity: 'warn', href: '/orders/zones',
    },
  ]

  return checks.filter(c => c.count > 0)
}
