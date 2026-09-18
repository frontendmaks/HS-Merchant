/**
 * Збирач цін.
 *
 * Деякі магазини не віддають сторінки серверу — Сільпо відповідає йому
 * перевіркою Cloudflare. Справжній браузер ту саму сторінку відкриває без
 * жодних питань, навіть у headless-режимі. Ця програма і є тим браузером:
 * питає панель, які сторінки потрібні, відкриває їх і віддає готовий HTML.
 *
 * Розбирати його вона не вміє і не мусить: уся логіка зіставлення й перерахунку
 * лишається в панелі, щоб її не довелося тримати у двох місцях однаковою.
 *
 * Запуск:
 *   npm install && npm run setup
 *   APP_URL=https://hs-merchant.vercel.app COLLECTOR_KEY=... npm start
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

// Налаштування беруться з .env поруч із програмою, якщо змінних немає в
// оточенні. Так запуск не залежить від того, як саме її стартують — руками,
// службою чи планувальником.
const envFile = path.join(import.meta.dirname, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const APP_URL = (process.env.APP_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.COLLECTOR_KEY ?? ''
const EVERY_MS = Number(process.env.POLL_SECONDS ?? 60) * 1000

if (!APP_URL || !KEY) {
  console.error('Потрібні змінні APP_URL і COLLECTOR_KEY')
  process.exit(1)
}

const api = (path, init = {}) => fetch(`${APP_URL}/api/prices/collector${path}`, {
  ...init,
  headers: {
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  },
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toLocaleTimeString('uk-UA'), ...a)

/**
 * Одна сторінка.
 *
 * Чекаємо не фіксовану паузу, а поки мережа стихне: магазини малюють товари
 * скриптом, і півсекунди рано означає порожню сторінку, а п'ять секунд пізно —
 * марно згаяний час на кожній позиції.
 */
async function render(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  try {
    await page.waitForLoadState('networkidle', { timeout: 20_000 })
  } catch {
    // Сторінка може тримати постійне з'єднання — тоді просто беремо що є
  }
  // Перевірка Cloudflare зникає сама за кілька секунд, якщо браузер справжній
  const title = await page.title().catch(() => '')
  if (/just a moment|attention required/i.test(title)) {
    await sleep(6000)
  }
  return page.content()
}

async function main() {
  log('Запускаємо браузер…')
  const browser = await chromium.launch({
    headless: process.env.HEADFUL !== '1',
    args: ['--disable-blink-features=AutomationControlled'],
  })

  // Профіль живе весь час роботи: cookie з пройденої перевірки зберігається,
  // і наступні сторінки відкриваються без неї
  const context = await browser.newContext({
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  log(`Готово. Питаємо ${APP_URL} кожні ${EVERY_MS / 1000} с`)

  for (;;) {
    try {
      const res = await api('')
      if (!res.ok) {
        log('Панель відповіла', res.status, res.status === 401 ? '— перевірте COLLECTOR_KEY' : '')
        await sleep(EVERY_MS)
        continue
      }

      const { tasks } = await res.json()
      if (!tasks?.length) {
        await sleep(EVERY_MS)
        continue
      }

      log(`Отримано завдань: ${tasks.length}`)
      for (const task of tasks) {
        try {
          const html = await render(page, task.url)
          const back = await api('', {
            method: 'POST',
            body: JSON.stringify({ id: task.id, html }),
          })
          const out = await back.json().catch(() => ({}))
          log(`  «${task.query}» → збережено позицій: ${out.stored ?? 0}`)
        } catch (e) {
          log(`  «${task.query}» → помилка: ${String(e).slice(0, 120)}`)
          await api('', {
            method: 'POST',
            body: JSON.stringify({ id: task.id, error: String(e).slice(0, 300) }),
          }).catch(() => {})
        }
        // Пауза між сторінками: це чужий сайт, а не наш
        await sleep(2500)
      }
    } catch (e) {
      log('Збій циклу:', String(e).slice(0, 160))
      await sleep(EVERY_MS)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
