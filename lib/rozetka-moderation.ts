/**
 * Чи не відхилила Rozetka наші картки.
 *
 * Заведена картка не продається, поки не пройде модерацію, а про
 * відмову Rozetka не пише нікуди, крім самого кабінету. Сім карток
 * пролежали відхиленими невідомо скільки — з коментарем модератора
 * «скорочення в назві», який ніхто не бачив, бо в кабінет ніхто не
 * заходив.
 *
 * Тому дивимось самі, щогодини, разом з рештою перевірок здоров'я.
 */
import { rozetkaGoods, RZ_STATUS } from '@/lib/rozetka-api'
import type { Check } from '@/lib/system-health'

export async function rozetkaModerationCheck(): Promise<Check | null> {
  const rejected = await rozetkaGoods(RZ_STATUS.rejected)
  if (!rejected.length) return null

  /* Коментар модератора кажемо дослівно: саме він підказує, що робити,
     а переказ своїми словами тут нічого не додає */
  const reasons = [...new Set(rejected.map(r => (r.comment ?? '').trim()).filter(Boolean))]

  return {
    key: 'rozetka-rejected',
    label: 'Rozetka: картки не пройшли модерацію',
    why: reasons.length
      ? `не продаються, поки не виправити: ${reasons.slice(0, 3).join('; ')}`
      : 'не продаються, поки не виправити',
    count: rejected.length,
    sample: rejected.slice(0, 6).map(r => r.name_ua),
    severity: 'bad',
    href: '/feeds',
  }
}
