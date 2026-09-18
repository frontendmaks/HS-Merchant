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
/**
 * Пишемо в stderr, а не в stdout.
 *
 * Коли програму запускають через `npm start`, її stdout — це канал, а не
 * термінал, і Node тримає написане в буфері, поки той не заповниться. Рядки
 * з'являються з затримкою в хвилини або не з'являються зовсім, хоча робота йде.
 * stderr у Node не буферизується, тож видно одразу.
 */
const log = (...a) => process.stderr.write(
  [new Date().toLocaleTimeString('uk-UA'), ...a].join(' ') + '\n')

/**
 * Одна сторінка.
 *
 * Чекаємо не фіксовану паузу, а поки мережа стихне: магазини малюють товари
 * скриптом, і півсекунди рано означає порожню сторінку, а п'ять секунд пізно —
 * марно згаяний час на кожній позиції.
 */
/**
 * Чи показує сторінка зараз перевірку безпеки.
 *
 * Українською вона каже «Триває перевірка безпеки», англійською — «Just a
 * moment». Перевірка лише заголовка англійською її не бачила, і сторінку з
 * перевіркою ми приймали за сторінку без товарів.
 */
async function isChallenge(page) {
  const title = await page.title().catch(() => '')
  if (/just a moment|attention required|перевірка/i.test(title)) return true
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '')
    .catch(() => '')
  return /перевірка безпеки|security check|just a moment|checking your browser/i.test(text)
}

/**
 * Кожна сторінка — у власній чистій сесії.
 *
 * Сесія, що накопичує cookie й історію переходів, за кілька запитів починає
 * виглядати для захисту сайту як автомат, і далі приходить сама лише перевірка
 * безпеки, яка вже не розходиться. Чиста сесія — це те, чим ми й є: відвідувач,
 * який зайшов подивитись одну ціну.
 */
async function withFreshPage(browser, fn) {
  const context = await browser.newContext({
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  })
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close()
  }
}

async function render(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })

  // Перевірка проходиться сама, якщо браузер справжній — але їй треба дати час
  for (let wait = 0; wait < 3 && await isChallenge(page); wait++) {
    log('    перевірка безпеки, чекаємо…')
    await sleep(8000)
  }

  // Чекаємо не тиші в мережі, а появи товарів.
  //
  // «Мережа стихла» настає й тоді, коли застосунок ще нічого не намалював —
  // повертається порожня оболонка на 29 КБ, і сторінка вважається такою, де
  // товарів немає. Різниця між «немає» і «ще не з'явились» тут вирішальна.
  const ready = 'a[href*="/product/"], a[href*="/tovar/"], [class*="product-card"], [class*="card__"]'
  try {
    await page.waitForSelector(ready, { timeout: 25_000, state: 'attached' })
    // Розмітка з'явилась — даємо домалювати ціни
    await page.waitForTimeout(1200)
  } catch {
    // Товарів немає навіть після очікування — можливо, їх справді немає
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: 8_000 })
  } catch {
    // Сайт може тримати постійне з'єднання — беремо що намальовано
  }

  return page.content()
}

async function main() {
  log('Запускаємо браузер…')
  const browser = await chromium.launch({
    headless: process.env.HEADFUL !== '1',
    args: ['--disable-blink-features=AutomationControlled'],
  })

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
          const html = await withFreshPage(browser, p => render(p, task.url))
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
        // Пауза між сторінками.
        //
        // Не ввічливість заради ввічливості: кілька швидких запитів поспіль
        // вмикають перевірку безпеки, після якої наступні сторінки приходять
        // порожніми. Людський темп дешевший за боротьбу з наслідками.
        await sleep(Number(process.env.GAP_SECONDS ?? 12) * 1000)
      }
    } catch (e) {
      log('Збій циклу:', String(e).slice(0, 160))
      await sleep(EVERY_MS)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
