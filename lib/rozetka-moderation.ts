/**
 * Чи продається те, що ми завели на Rozetka.
 *
 * Заведена картка не продається, поки не пройде модерацію, а про те, що
 * з нею сталось, Rozetka не пише нікуди, крім самого кабінету. Спершу
 * сім карток пролежали відхиленими невідомо скільки — з коментарем
 * модератора «скорочення в назві», якого ніхто не бачив.
 *
 * Потім вийшло гірше й тихіше: сімдесят шість карток, якими ми продавали
 * до вересня, Rozetka перевела в архів своєю задачею. Жодного листа,
 * жодної помилки в наших журналах — просто з 19 вересня не стало
 * замовлень. Тому дивимось самі, щогодини, на всі статуси одразу.
 */
import { rozetkaAllGoods, RZ_STATUS, type RozetkaGood } from '@/lib/rozetka-api'
import type { Check } from '@/lib/system-health'

/** Скільки днів чекання на модератора ще вважаємо нормою */
const MODERATION_DAYS = 3

const names = (goods: RozetkaGood[]) => goods.slice(0, 6).map(g => g.name_ua)

/* Коментар модератора кажемо дослівно: саме він підказує, що робити,
   а переказ своїми словами тут нічого не додає */
function comments(goods: RozetkaGood[]): string[] {
  return [...new Set(goods.map(g => (g.comment ?? '').trim()).filter(Boolean))]
}

function daysSince(created: string | null): number {
  if (!created) return 0
  const at = Date.parse(created.replace(' ', 'T'))
  return Number.isNaN(at) ? 0 : Math.floor((Date.now() - at) / 86_400_000)
}

export async function rozetkaCatalogChecks(): Promise<Check[]> {
  const goods = await rozetkaAllGoods()
  if (!goods.length) return []

  const byStatus = (status: number) => goods.filter(g => g.upload_status === status)
  const checks: Check[] = []

  const archived = byStatus(RZ_STATUS.archived)
  if (archived.length) {
    const why = comments(archived)
    checks.push({
      key: 'rozetka-archived',
      label: 'Rozetka сховала картки в архів',
      why: `не продаються і самі не повернуться${why.length ? `: ${why.slice(0, 2).join('; ')}` : ''}`,
      count: archived.length, sample: names(archived), severity: 'bad', href: '/feeds',
    })
  }

  const rejected = byStatus(RZ_STATUS.rejected)
  if (rejected.length) {
    const why = comments(rejected)
    checks.push({
      key: 'rozetka-rejected',
      label: 'Rozetka: картки не пройшли модерацію',
      why: why.length
        ? `не продаються, поки не виправити: ${why.slice(0, 3).join('; ')}`
        : 'не продаються, поки не виправити',
      count: rejected.length, sample: names(rejected), severity: 'bad', href: '/feeds',
    })
  }

  const odd = byStatus(RZ_STATUS.oddPrice)
  if (odd.length) {
    checks.push({
      key: 'rozetka-odd-price',
      label: 'Rozetka: аномальна ціна',
      why: 'картку притримали через ціну — зазвичай це наша помилка в прайсі, а не вимога Rozetka',
      count: odd.length, sample: names(odd), severity: 'bad', href: '/feeds',
    })
  }

  /*
   * Чекання саме по собі не біда — модератор дивиться кілька днів. Бідою
   * воно стає, коли весь каталог стоїть у черзі тижнями, а ми думаємо,
   * що продаємо.
   */
  const waiting = byStatus(RZ_STATUS.onModeration).filter(g => daysSince(g.created_at) >= MODERATION_DAYS)
  if (waiting.length) {
    const longest = Math.max(...waiting.map(g => daysSince(g.created_at)))
    checks.push({
      key: 'rozetka-waiting',
      label: 'Rozetka: картки досі на модерації',
      why: `чекають уже ${longest} дн. — до кінця модерації вони не продаються`,
      count: waiting.length, sample: names(waiting), severity: 'warn', href: '/feeds',
    })
  }

  /*
   * Фото Rozetka тягне до себе сама, і коли похід по знімок не вдався,
   * картка однаково створюється — з порожнім `photo` і заглушкою
   * «no-image». Помилки немає ніде, тому шістдесят сім таких пролежали
   * непоміченими від самого заведення.
   */
  const photoless = goods.filter(g => g.photo_upload_status !== 1)
  if (photoless.length) {
    checks.push({
      key: 'rozetka-no-photo',
      label: 'Rozetka не взяла фото',
      why: 'у картці заглушка замість знімка — наступний прохід вивантаження надішле його ще раз',
      count: photoless.length, sample: names(photoless), severity: 'warn', href: '/feeds',
    })
  }

  return checks
}
