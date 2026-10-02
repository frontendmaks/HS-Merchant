import { NextResponse } from 'next/server'
import { getCurrentRole } from '@/lib/getRole'
import { canAccess, type PAGE_ROLES } from '@/lib/roles'

/**
 * Перевірка прав на боці сервера.
 *
 * Сховати кнопку — не те саме, що заборонити дію: адреса лишається відкритою
 * для будь-кого, хто її знає. Глядач бачить синхронізації лише щоб дивитись,
 * і саме тут це стає правдою, а не лише виглядом.
 */
const READ_ONLY_ROLES = ['viewer', 'analyst']

export async function requireWrite(
  page: keyof typeof PAGE_ROLES,
): Promise<NextResponse | null> {
  const role = await getCurrentRole()

  if (!role) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccess(page, role)) {
    return NextResponse.json({ success: false, error: 'Немає доступу' }, { status: 403 })
  }
  if (READ_ONLY_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, error: 'Ваша роль — лише перегляд' }, { status: 403 })
  }
  return null
}
