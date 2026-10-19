/**
 * Сторінки, які показуються без обв'язки Мерчанта — без сайдбара й відступів.
 *
 * Крім входу це бланк замовлення: його відкриває комірник за посиланням,
 * акаунта в Мерчанті не має, і меню з чужими розділами йому ні до чого.
 */
export function isChromeless(path: string): boolean {
  return path === '/login'
    || path === '/set-password'
    || path.startsWith('/zamovlennya/')
}
