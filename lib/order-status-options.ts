import { STAGE_NAMES } from '@/lib/bitrix-stages'

/**
 * Статуси, які можна поставити вручну.
 *
 * У кожного майданчика свій словник, і вибір мусить його повторювати —
 * інакше статус не приймуть на тому боці. Замовлення з сайту нікуди не
 * надсилаються, тож тримаємо найкоротший перелік, який описує шлях від
 * прийому до доставки.
 */
export const MAUDAU_STATUSES = [
  'Нове', 'Прийнято', 'Узгоджено', 'На доставці', 'Прибуло', 'Доставлено', 'Скасовано',
]

/*
 * Prom приймає рівно чотири: received, paid, delivered, canceled. На
 * pending і draft відповідає «This status value is not allowed», тож
 * «Нове» лишається тут як стан, у якому замовлення приходить, але
 * поставити його руками не можна — список це й показує.
 */
export const PROM_STATUSES = [
  'Нове', 'Прийнято', 'Оплачено', 'Доставлено', 'Скасовано',
]

/** Статуси, які майданчик ставить сам, а ми лише бачимо */
export const READ_ONLY_STATUSES: Record<string, string[]> = {
  prom: ['Нове'],
}

export const ROZETKA_STATUSES = [
  'Нове', 'Опрацьовується', 'Комплектується', 'Передано в доставку',
  'Доставляється', 'Чекає в пункті', 'Доставлено', 'Скасовано',
]

/**
 * Замовлення з сайту й телефону живуть у воронці Бітрікса, тож і статуси в
 * них звідти: оператор у CRM і оператор у Мерчанті мають називати той самий
 * стан тим самим словом.
 */
export const SITE_STATUSES = STAGE_NAMES

export function statusOptions(platform: string | null): string[] {
  if (platform === 'rozetka') return ROZETKA_STATUSES
  if (platform === 'maudau') return MAUDAU_STATUSES
  if (platform === 'prom') return PROM_STATUSES
  return SITE_STATUSES
}
