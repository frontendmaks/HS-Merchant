/**
 * Який склад везе замовлення за цією адресою.
 *
 * Сайт тримає карту зон доставки у вигляді полігонів, і саме від неї
 * відштовхується вся доставка. Ми беремо ту саму карту — інакше склад у
 * Мерчанті й склад на сайті рано чи пізно розійдуться, і дізнаємось ми про це
 * з телефонного дзвінка розгубленого комірника.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

import { hasLatin, toCyrillic } from '@/lib/address-latin'
import { GIVEN_NAMES } from '@/lib/given-names'

export const ZONES_URL =
  'https://halytska-svizhyna.ua/wp-content/uploads/2026/06/zona-dostavky-1.json'

export interface Point { lat: number; lng: number }

export interface ZoneHit {
  zone: string
  warehouse: string
}

/**
 * Чи лежить точка всередині полігона.
 *
 * Промінь праворуч від точки: непарна кількість перетинів межі означає, що
 * точка всередині. Працює і для опуклих, і для вигнутих зон — а зони на цій
 * карті вигнуті, вони обходять річку й залізницю.
 */
export function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const straddles = (a.lat > p.lat) !== (b.lat > p.lat)
    if (!straddles) continue
    const x = ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    if (p.lng < x) inside = !inside
  }
  return inside
}

/** Тягне карту з сайту й оновлює нашу копію. */
export async function refreshZones(service: Service): Promise<{ updated: number; error?: string }> {
  try {
    const res = await fetch(ZONES_URL, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { updated: 0, error: `Сайт відповів ${res.status}` }

    const data = await res.json() as {
      areas?: Record<string, { color?: string; coordinates?: Point[] }>
    }
    const areas = data.areas ?? {}
    let updated = 0

    for (const [code, area] of Object.entries(areas)) {
      const polygon = (area.coordinates ?? []).filter(
        p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      if (polygon.length < 3) continue

      await service.from('delivery_zones').update({
        polygon, color: area.color ?? null, updated_at: new Date().toISOString(),
      }).eq('code', code)
      updated++
    }
    return { updated }
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Зона й склад за координатами.
 *
 * Зони на карті подекуди перекриваються — на межі міста їх малювали руками.
 * Коли точка потрапляє в кілька, береться перша за порядком: він відповідає
 * порядку в налаштуваннях сайту, тож вибір збігається з тим, що зробив би сайт.
 */
interface ZoneRow { code: string; warehouse: string; polygon: Point[] }

/** Зони з бази — вісім полігонів, які перевіряються по кілька разів на адресу,
 *  тож читаються один раз і далі перебираються в пам'яті. */
export type DayKind = 'weekday' | 'sunday'

/**
 * Якою картою їздять цього дня.
 *
 * У неділю возять не ті самі склади й не ті самі межі, тож карта окрема.
 * День беремо з дати доставки, а не з сьогоднішньої: замовлення на неділю
 * складають у середу, і склад йому належить недільний.
 */
export function dayKindFor(deliveryDate: string | null | undefined): DayKind {
  if (!deliveryDate) return 'weekday'
  // Полудень, щоб перехід на зимовий час не зсунув день на попередній
  return new Date(`${deliveryDate}T12:00:00`).getDay() === 0 ? 'sunday' : 'weekday'
}

export async function loadZones(
  service: Service,
  dayKind: DayKind = 'weekday',
): Promise<ZoneRow[]> {
  const { data } = await service
    .from('delivery_zones').select('code, warehouse, polygon')
    .eq('day_kind', dayKind)
    .order('code')

  return (data ?? []).map(z => ({
    code: z.code as string,
    warehouse: z.warehouse as string,
    polygon: (z.polygon as Point[]) ?? [],
  }))
}

export function zoneAt(point: Point, zones: ZoneRow[]): ZoneHit | null {
  for (const z of zones) {
    if (z.polygon.length >= 3 && insidePolygon(point, z.polygon)) {
      return { zone: z.code, warehouse: z.warehouse }
    }
  }
  return null
}

export async function zoneForPoint(
  service: Service,
  point: Point,
  dayKind: DayKind = 'weekday',
): Promise<ZoneHit | null> {
  return zoneAt(point, await loadZones(service, dayKind))
}

const GEOCODER_UA =
  'HS-Merchant/1.0 (order intake; https://hs-merchant.vercel.app)'

export interface Geocoded extends Point {
  display_name: string | null
  /** Збіг «десь тут»: вулиця без номера або сам населений пункт */
  approximate?: boolean
  /** Наскільки саме «десь тут» — щоб підпис не вигадував */
  vague?: 'street' | 'area'
}

/**
 * Район Львова або село — з того, що відповів геокодер.
 *
 * Для наших замовлень область нічого не каже: вони всі львівські. Значення
 * має район міста чи село, бо саме між ними ділиться робота складів.
 * У відповіді геокодера район стоїть поруч зі Львовом, а село — перед своєю
 * громадою.
 */
export function areaFromDisplay(display: string | null | undefined): string | null {
  if (!display) return null
  const parts = display.split(',').map(p => p.trim()).filter(Boolean)

  if (parts.includes('Львів')) {
    const district = parts.find(p => p.endsWith('район'))
    if (district) return district
  }

  const hromada = parts.findIndex(p => p.includes('громада'))
  if (hromada > 0) return parts[hromada - 1]

  return null
}

/** Геокодер мовчить — питання про адресу лишається без відповіді. */
export class GeocoderUnavailable extends Error {
  constructor() { super('Геокодер не відповідає') }
}

/**
 * Координати адреси.
 *
 * Nominatim безкоштовний і просить не частіше одного запиту на секунду — для
 * ручних замовлень цього вдосталь. Результат кешується: та сама адреса
 * питається один раз, і повторне відкриття форми нікого не турбує.
 */
/**
 * Відповідь геокодера, у якій «не знайшов» і «не відповів» — різні речі.
 *
 * Раніше обидва випадки виглядали як порожнеча, і відмова сервісу осідала в
 * кеші як «такої адреси немає». Одна хвилина недоступності отруювала сотню
 * адрес назавжди.
 */
type Answer =
  | { kind: 'found'; point: Geocoded }
  | { kind: 'missing' }
  | { kind: 'unavailable'; status: number | string }

async function ask(query: string): Promise<Answer> {
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&limit=1&countrycodes=ua&accept-language=uk&q=' + encodeURIComponent(query)
    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODER_UA },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { kind: 'unavailable', status: res.status }

    const hits = await res.json() as { lat: string; lon: string; display_name: string }[]
    const first = hits[0]
    return first
      ? { kind: 'found', point: { lat: Number(first.lat), lng: Number(first.lon), display_name: first.display_name } }
      : { kind: 'missing' }
  } catch (e) {
    return { kind: 'unavailable', status: e instanceof Error ? e.name : 'error' }
  }
}

/**
 * Адреса з сайту — у вигляді, який розуміє геокодер.
 *
 * Сайт складає її з полів форми й лишає по собі сліди цієї форми:
 * «м.Львів, Львів, вулиця Трускавецька, буд. № 2, під. 3, пов. 5, кв. 42».
 * Геокодеру з цього потрібні три речі — місто, вулиця, будинок; решта для
 * нього шум, через який він не знаходить нічого.
 */
export function tidyAddress(raw: string): string {
  /**
   * Квартира, під'їзд, поверх і домофон можуть стояти як окремою частиною,
   * так і всередині неї: «Патона буд. 27 кв. 124» — одна кома на все. Тому
   * спершу відрізаємо все від першого такого слова, а вже потім розбираємо
   * решту по комах.
   */
  const TAIL = /(під|підʼ?їзд|пов|поверх|кв|квартира|домофон|дом|корп|корпус|офіс)(?![\p{L}])[\s.№]*\d.*$/iu

  const parts = raw
    .replace(/\\'/g, '’')
    // Код складу з довідника сайту: «/053_Сокільники»
    .replace(/\/\d+_/g, '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.replace(TAIL, '').trim())
    .filter(p => !/^(під|підʼ?їзд|пов|поверх|кв|квартира|домофон|корп|корпус|офіс)(?![\p{L}])/iu
      .test(p))
    .map(p => p
      // Крапка або пробіл обов'язкові: інакше «Мшана» лишається «шана»
      .replace(/^(м|с|смт|сщ)\.\s*|^(м|с|смт)\s+/i, '')
      /**
       * «Малечковичі вул.Степана Чарнецького» — геокодер хоче кому між
       * населеним пунктом і вулицею.
       *
       * Лише коли слово «вул.» вводить назву, тобто за ним одразу йде сама
       * назва. Інакше правило спрацьовувало й на «Стрийська вул.», де тип
       * стоїть після назви, — виходило «Стрийська, вул.», і геокодер читав
       * це як дві різні частини адреси. Будинок 111Д так опинявся на іншому
       * кінці вулиці, у чужій зоні доставки.
       *
       * Три пастки в одному рядку, і на всіх трьох я вже попався:
       *
       * Прапорець `i` робив перевірку на велику літеру безглуздою, бо
       * з ним [А-Я] збігається і з малими. Тому тут його немає, а великі
       * літери перевіряються через \p{Lu}.
       *
       * Коротший варіант у переліку мусить стояти після довшого: при
       * `вул|вулиця` рушій брав «вул» усередині «вулиця» й розривав слово
       * навпіл — «Басівка вулиця Зелена» ставала «Басівка, вул. иця
       * Зелена», і геокодер знаходив лише село.
       *
       * Крапку дописуємо тільки до скорочення: «вулиця.» — не слово.
       */
      .replace(
        /\s+([Вв]улиця|[Вв]ул|[Пп]роспект|[Пп]росп|[Пп]ровулок|[Пп]ров)(?![\p{L}])\.?\s*(?=\p{Lu})/gu,
        (_, type: string) => `, ${type}${type.length <= 5 ? '.' : ''} `,
      )
      // «Село Мшана» — слово зайве, назва самодостатня; «будинок бічна» теж
      .replace(/^(село|селище|місто)\s+/iu, '')
      .replace(/^будинок\s+(?!\d)/iu, '')
      .replace(/буд(?![\p{L}])\.?\s*№?\s*/giu, '')
      // Ініціал біля прізвища: «вул. Виговського І.» геокодер не впізнає,
      // «вул. Виговського» — впізнає
      .replace(/(^|\s)[А-ЯІЇЄҐA-Z]\.(?=\s|$)/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)

  // «м.Львів, Львів» — те саме місто двічі, бо в одному полі його вписали, а
  // друге підставилось зі списку
  const unique: string[] = []
  for (const p of parts) {
    if (!unique.some(u => u.toLowerCase() === p.toLowerCase())) unique.push(p)
  }
  return unique.join(', ')
}

/**
 * Як саме питати геокодер про цю адресу.
 *
 * «Петлюри 14» без міста спершу уточнювалось як «Львівська область» — і
 * знаходило Дрогобич, бо вулиця Петлюри є і там. Місто важливіше за область:
 * ми возимо по Львову й околицях, тож питаємо спершу про Львів.
 */
/**
 * Ті самі вулиці, записані інакше.
 *
 * Львівські назви живуть у двох редакціях одночасно. Сайт пише «Верхня
 * Зимова», а в мапі вона «Зимова Горішня»: і прикметник інший, і стоїть він
 * з іншого боку. Геокодер від цього не знаходить нічого — хоча будинок у
 * нього є, за три кілометри від того місця, куди ми врешті цілились.
 *
 * Тому перебираємо обидві редакції: і синоніми, і зворотний порядок слів.
 * Усі вони лишаються точними прочитаннями — номер будинку в них є.
 */
const ADJ_SYNONYMS: Record<string, string> = {
  'верхня': 'горішня', 'горішня': 'верхня',
  'верхній': 'горішній', 'горішній': 'верхній',
  'нижня': 'долішня', 'долішня': 'нижня',
  'нижній': 'долішній', 'долішній': 'нижній',
}

/**
 * Прикметники, що стоять у назві то спереду, то ззаду.
 *
 * Перебирати порядок слів у кожній назві було б марно: «Степана Бандери»
 * задом наперед не існує, а кожне зайве прочитання — ще один запит до
 * геокодера, який нас і так обмежує. Міняємо місцями лише там, де
 * розходження справді трапляється.
 */
const SWAPPABLE = new Set([
  'верхня', 'горішня', 'нижня', 'долішня',
  'верхній', 'горішній', 'нижній', 'долішній',
  'велика', 'мала', 'нова', 'стара', 'великий', 'малий', 'новий', 'старий',
])

const STREET_WORD = /^(вул|вулиця|просп|проспект|пров|провулок)\.?$/iu

/** «горішня» → «Горішня»: кеш і журнал читаються людьми */
const matchCase = (word: string, sample: string) =>
  /^\p{Lu}/u.test(sample) ? word.charAt(0).toUpperCase() + word.slice(1) : word

/** Інші написання кожної частини адреси, що схожа на назву вулиці */
export function streetSpellings(address: string): string[] {
  const parts = address.split(',').map(p => p.trim())
  const out = new Set<string>()

  parts.forEach((part, index) => {
    const words = part.split(/\s+/).filter(Boolean)
    const type = words.length && STREET_WORD.test(words[0]) ? words[0] : null
    const name = type ? words.slice(1) : words

    // Назва з двох слів, одне з яких — прикметник: рівно той випадок, де
    // редакції розходяться
    if (name.length !== 2) return
    if (!name.some(w => SWAPPABLE.has(w.toLowerCase()))) return

    const spellings = new Set<string>()
    const swapped = [name[1], name[0]]
    spellings.add(swapped.join(' '))

    for (const order of [name, swapped]) {
      const synonym = order.map(w => {
        const other = ADJ_SYNONYMS[w.toLowerCase()]
        return other ? matchCase(other, w) : w
      })
      if (synonym.join(' ') !== order.join(' ')) spellings.add(synonym.join(' '))
    }

    for (const spelling of spellings) {
      const rebuilt = [...parts]
      rebuilt[index] = [type, spelling].filter(Boolean).join(' ')
      const whole = rebuilt.join(', ')
      if (whole !== address) out.add(whole)
    }
  })

  return [...out]
}

/**
 * Чи це слово — ім'я людини в родовому відмінку.
 *
 * Вулиці часто звуться «Ім'я Прізвище», і джерела розходяться саме в імені:
 * в адресі «Миколи Коперника», а в карті — «Миколая Коперника». Прізвище ж
 * збігається завжди, бо воно й несе назву.
 *
 * Перевіряємо за списком імен, який уже є: з родового відмінка вгадуємо
 * називний кількома очевидними закінченнями й питаємо, чи знаємо таке ім'я.
 * Це не морфологія, а саме перевірка — помилитись тут означає додати зайвий
 * варіант запиту, не більше.
 */
function givenNameInGenitive(word: string): boolean {
  const w = word.toLowerCase()
  const guesses = [
    w,
    w.replace(/а$/, ''),      // Степана → Степан
    w.replace(/и$/, 'а'),     // Миколи → Микола
    w.replace(/я$/, 'ь'),     // Василя → Василь
    w.replace(/я$/, 'й'),     // Андрія → Андрій
    w.replace(/і$/, 'я'),     // Лесі → Леся
    w.replace(/ї$/, 'я'),     // Марії → Марія
  ]

  // Список зберігається в нижньому регістрі — там же й питаємо
  return guesses.some(g => GIVEN_NAMES.has(g))
}

/**
 * Назва вулиці без імені — саме прізвище.
 *
 * «вулиця Миколи Коперника» → «вулиця Коперника». Геокодер знає цю вулицю як
 * «Миколая Коперника» й на «Миколи» не знаходить нічого, а на саме прізвище
 * знаходить одразу й точно — із номером будинку.
 *
 * Ім'я прибираємо лише тоді, коли воно справді ім'я: «Зелена Балка» чи «Під
 * Голоском» так не скорочуються, інакше ми питали б про зовсім іншу вулицю.
 */
export function withoutGivenName(address: string): string | null {
  const parts = address.split(',').map(p => p.trim())
  let changed = false

  const rebuilt = parts.map(part => {
    const words = part.split(/\s+/).filter(Boolean)
    const type = words.length && STREET_WORD.test(words[0]) ? words[0] : null
    const name = type ? words.slice(1) : words

    // Потрібні рівно ім'я та прізвище: з трьох слів ім'я вже не вгадаєш
    if (name.length !== 2) return part
    if (!givenNameInGenitive(name[0])) return part

    changed = true
    return [type, name[1]].filter(Boolean).join(' ')
  })

  return changed ? rebuilt.join(', ') : null
}

/**
 * Чому цей збіг приблизний — своїми словами, а не загальною фразою.
 *
 * Раніше будь-яке приблизне прочитання діставало підпис «зона визначена за
 * вулицею, без номера будинку». Для адреси, яку геокодер звузив усього лише
 * до міста, це була неправда — і оператор довіряв складу, обраному за
 * центром Львова.
 */
type Vagueness = 'street' | 'area'

interface Variant {
  query: string
  approximate?: boolean
  vague?: Vagueness
  /**
   * Населений пункт, у якому відповідь має бути.
   *
   * Потрібно там, де ми скоротили саму назву вулиці: саме прізвище без
   * імені буває не одне на область. «Шептицького, 4» без «Андрія» геокодер
   * знаходить у Пасіках-Зубрицьких — вулиця є і там, і це не наша адреса.
   * Тож відповідь приймаємо лише тоді, коли місто в ній те саме.
   */
  within?: string
}

function queryVariants(address: string): Variant[] {
  const a = tidyAddress(address)
  const mentionsCity = /львів|брюховичі|винники|сокільники|зимна вода|рудно|малехів|солонка|пустомити|сихів/i.test(a)

  const city = (q: string) => (mentionsCity ? q : `Львів, ${q}`)

  /**
   * Літера в номері будинку — «17а», «35б» — для геокодера часто зайва: сам
   * будинок він знає, а з літерою не знаходить нічого.
   */
  const withoutLetter = a.replace(/(\d+)\s*[а-яіїєґa-z](?![\p{L}\d])/giu, '$1')

  /**
   * Вулиця без номера будинку.
   *
   * Останній рубіж, і несподівано надійний: нам потрібна зона доставки, а не
   * під'їзд. Вулиця цілком лежить в одній зоні майже завжди, тож точка на ній
   * відповідає на те саме питання, що й точний будинок.
   */
  const streetOnly = a.replace(/,?\s*\d+\s*[а-яіїєґa-z]?\s*$/iu, '').trim()

  /** Назва латиницею — геокодер знає ці вулиці лише українською */
  const cyrillic = hasLatin(a) ? toCyrillic(a) : null

  /** Село чи містечко окремо: «Малечковичі, Львівська область» */
  const settlement = a.split(',')[0].trim()

  /**
   * Коротші прочитання адреси.
   *
   * У кінці часто висить те, що адресою не є: назва закладу, орієнтир,
   * «домофон 22» чи ім'я отримувача. Геокодер від цього губиться цілком,
   * хоча початок рядка — місто, вулиця й будинок — читається без проблем.
   * Тому пробуємо ще й перші дві-три частини.
   */
  const parts = a.split(',').map(p => p.trim()).filter(Boolean)
  const shorter = [3, 2]
    .filter(n => parts.length > n)
    .map(n => parts.slice(0, n).join(', '))

  /**
   * Точні прочитання йдуть першими, приблизні — наприкінці.
   *
   * Вулиця без номера й сам населений пункт відповідають «десь тут», а не
   * «тут»: довга вулиця перетинає кілька зон доставки, і точка на її початку
   * вкаже чужий склад. Такі збіги позначаємо, щоб вони не перебивали склад,
   * обраний людиною.
   */
  /*
   * Те саме, але без імені у назві вулиці.
   *
   * «Миколи Коперника» проти «Миколая Коперника» — різниця в одному слові,
   * і геокодер на ній спиняється цілком, хоча прізвище однакове. Варіант
   * лишається точним: номер будинку в ньому зберігся, тож і відповідь буде
   * про будинок, а не «десь на вулиці».
   */
  const bySurname = withoutGivenName(a)


  const exact = [
    city(a),
    a,
    ...(withoutLetter !== a ? [city(withoutLetter)] : []),

    ...(cyrillic && cyrillic !== a ? [city(cyrillic), cyrillic] : []),
    ...streetSpellings(a).map(city),
    ...streetSpellings(withoutLetter).map(city),
    ...shorter.map(city),
  ]
  /*
   * Скорочена назва — після всіх точних, але перед приблизними.
   *
   * Вона точна за змістом: номер будинку на місці. Але назва вже не та,
   * яку написали, тож пробуємо її лише тоді, коли написане не знайшлося.
   */
  const shortened: Variant[] = bySurname
    ? [{
        query: city(bySurname),
        // Де має опинитись відповідь: там само, де й сама адреса
        within: mentionsCity ? (settlement || 'Львів') : 'Львів',
      }]
    : []

  const rough: Variant[] = [
    ...(streetOnly && streetOnly !== a
      ? [{ query: city(streetOnly), vague: 'street' as const }] : []),
    { query: `Львівська область, ${a}`, vague: 'area' as const },
    ...(settlement && settlement !== a
      ? [{ query: `${settlement}, Львівська область`, vague: 'area' as const }] : []),
  ]

  const seen = new Set<string>()
  const out: Variant[] = []

  for (const query of exact) {
    if (query.replace(/[^\p{L}]/gu, '').length < 4 || seen.has(query)) continue
    seen.add(query)
    out.push({ query, approximate: false })
  }
  /*
   * Скорочена назва стоїть між точними й приблизними.
   *
   * Вона точна за змістом — номер будинку на місці, — але назва вже не та,
   * яку написали, тож пробуємо її лише після написаного.
   */
  for (const variant of shortened) {
    if (seen.has(variant.query)) continue
    seen.add(variant.query)
    out.push({ ...variant, approximate: false })
  }

  for (const variant of rough) {
    if (variant.query.replace(/[^\p{L}]/gu, '').length < 4 || seen.has(variant.query)) continue
    seen.add(variant.query)
    out.push({ ...variant, approximate: true })
  }

  return out
}

/**
 * Чи лежить знайдена точка в названому населеному пункті.
 *
 * Геокодер віддає адресу частинами через кому, і місто в ній стоїть
 * окремою частиною. Порівнюємо саме частини, а не підрядок: «Львівський
 * район» містить «Львів», але Львовом не є.
 */
export function inSettlement(display: string | null | undefined, place: string): boolean {
  if (!display) return false
  const want = place.trim().toLowerCase()
  return display.split(',').some(part => part.trim().toLowerCase() === want)
}

/**
 * Слова, за якими впізнають вулицю.
 *
 * Тип («вулиця», «провулок»), місто й надто короткі слова нічого не
 * розрізняють: за ними збігається будь-що. Лишаємо тільки назву — те, що
 * справді відрізняє одну вулицю від іншої.
 */
const STREET_NOISE = new Set([
  'вул', 'вулиця', 'просп', 'проспект', 'пров', 'провулок', 'площа', 'дорога',
  'набережна', 'бульвар', 'буд', 'будинок', 'львів', 'львівська', 'область',
  'район', 'громада', 'міська', 'сільська', 'селищна', 'україна',
])

function streetWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’'ʼ`]/g, "'")
    .split(/[^\p{L}]+/u)
    .filter(w => w.length >= 4 && !STREET_NOISE.has(w))
}

/**
 * Чи про ту саму вулицю питали й відповіли.
 *
 * Геокодер майже завжди щось знаходить — і коли написаної вулиці він не
 * знає, віддає сусідню або схожу. Точка при цьому лягає в зону доставки,
 * і склад виходить чужий, а сказати про це нікому.
 *
 * Звіряємо за початком слів, а не за цілими: «Стрийська» й «Стрийській» —
 * та сама вулиця, а «Зелена» й «Зелінського» — різні.
 */
export function sameStreet(address: string, display: string | null | undefined): boolean {
  if (!display) return false

  const asked = streetWords(address)
  // Нема за чим звіряти — не наша справа судити
  if (!asked.length) return true

  const found = streetWords(display)
  const stem = (w: string) => w.slice(0, Math.min(5, w.length))

  return asked.some(a => found.some(f => stem(a) === stem(f)))
}

/**
 * Версія логіки пошуку адреси.
 *
 * Піднімається щоразу, коли змінюється те, як складається запит до геокодера:
 * записи кешу з нижчою версією перепитуються, замість того щоб вічно
 * повертати координати, знайдені за старим правилом.
 */
const RESOLVER_VERSION = 10

async function remember(
  service: Service,
  query: string,
  point: Geocoded | null,
): Promise<void> {
  await service.from('geocode_cache').upsert({
    query,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    display_name: point?.display_name ?? null,
    approximate: point?.approximate ?? false,
    vague: point?.vague ?? null,
    resolver: RESOLVER_VERSION,
  }, { onConflict: 'query' })
}

export async function geocode(
  service: Service,
  address: string,
): Promise<Geocoded | null> {
  const query = address.trim()
  if (query.length < 5) return null

  const { data: cached } = await service
    .from('geocode_cache').select('lat, lng, display_name, approximate, vague, resolver')
    .eq('query', query).maybeSingle()

  // Кеш старої версії не використовуємо: він пам'ятає відповідь, а не спосіб,
  // яким її отримали, і після зміни способу тихо скасовував би виправлення —
  // «Петлюри 14» так і лишалося б у Дрогобичі, вже знайденому раніше.
  if (cached && Number(cached.resolver ?? 1) >= RESOLVER_VERSION) {
    return cached.lat == null ? null : {
      lat: Number(cached.lat), lng: Number(cached.lng),
      display_name: cached.display_name as string,
      approximate: !!cached.approximate,
      vague: (cached.vague as 'street' | 'area' | null) ?? undefined,
    }
  }

  /**
   * Беремо перший варіант, що потрапляє в зону доставки.
   *
   * Сама по собі «знайдена точка» ще нічого не означає — геокодер майже
   * завжди щось знаходить. Значення має точка, куди ми реально возимо, тож
   * саме це й перевіряємо, перш ніж спинитись.
   */
  let firstHit: Geocoded | null = null
  let refused = false
  const zones = await loadZones(service)

  for (const variant of queryVariants(query)) {
    const answer = await ask(variant.query)

    if (answer.kind === 'unavailable') {
      // Сервіс не відповів — це не відповідь про адресу. Припиняємо й нічого
      // не запам'ятовуємо: наступний прохід спитає заново
      refused = true
      break
    }

    if (answer.kind === 'found') {
      /*
       * Відповідь має бути в тому ж населеному пункті, що й питання.
       *
       * Стосується скорочених назв: саме прізвище без імені буває не одне
       * на область. «Шептицького, 4» без «Андрея» знаходиться в Пасіках-
       * Зубрицьких — вулиця є і там, будинок теж, і зона доставки поруч.
       * Без цієї перевірки ми тихо повезли б замовлення в інше село.
       */
      if (variant.within && !inSettlement(answer.point.display_name, variant.within)) {
        await new Promise(r => setTimeout(r, 1100))
        continue
      }

      const point = { ...answer.point, approximate: variant.approximate, vague: variant.vague }
      firstHit ??= point
      if (zoneAt(point, zones)) {
        await remember(service, query, point)
        return point
      }
    }

    // Чужий сервіс просить не частіше разу на секунду
    await new Promise(r => setTimeout(r, 1100))
  }

  // Жоден варіант не потрапив у зону — лишаємо перший знайдений, щоб
  // оператор бачив, що саме розпізналось, і міг виправити адресу
  if (firstHit) {
    await remember(service, query, firstHit)
    return firstHit
  }

  if (refused) throw new GeocoderUnavailable()

  await remember(service, query, null)
  return null
}

/** Назва вулиці з відповіді геокодера — для підпису, а не для порівняння */
export function streetFromDisplay(display: string | null | undefined): string {
  const parts = (display ?? '').split(',').map(p => p.trim()).filter(Boolean)
  // Перша частина — номер будинку, друга зазвичай вулиця
  const street = parts.find(p => /вулиц|проспект|провул|площа|дорога|набережна|бульвар/i.test(p))
  return street ?? parts[1] ?? parts[0] ?? '—'
}

export interface AddressResolution {
  point: Geocoded | null
  zone: string | null
  warehouse: string | null
  /** Чому складу немає — щоб оператор бачив причину, а не порожнє поле */
  note: string | null
}

export async function resolveAddress(
  service: Service,
  address: string,
  /** День доставки — від нього залежить, якою картою ділять місто */
  deliveryDate?: string | null,
): Promise<AddressResolution> {
  const point = await geocode(service, address)
  if (!point) {
    return {
      point: null, zone: null, warehouse: null,
      note: 'Адресу не вдалося розпізнати — оберіть склад вручну',
    }
  }

  const kind = dayKindFor(deliveryDate)
  const hit = await zoneForPoint(service, point, kind)
  if (!hit) {
    return {
      point, zone: null, warehouse: null,
      note: kind === 'sunday'
        ? 'Адреса поза недільними зонами доставки — оберіть склад вручну'
        : 'Адреса поза зонами доставки — оберіть склад вручну',
    }
  }

  /*
   * Знайдена вулиця має бути тією, яку писали.
   *
   * Геокодер майже завжди щось знаходить, і коли написаної вулиці він не
   * знає, віддає схожу. Точка лягає в зону доставки, склад виходить
   * чужий — і нічого про це не сказано: замовлення виглядає оглянутим без
   * жодної хиби. Тому звіряємо назву й кажемо, що саме знайшлось.
   */
  const wrongStreet = !point.vague && !sameStreet(tidyAddress(address), point.display_name)

  return {
    point,
    zone: hit.zone,
    warehouse: hit.warehouse,
    note: point.vague === 'area'
      ? 'Адресу розпізнано лише до міста — вулиці геокодер не знає, перевірте склад'
      : point.approximate
        ? 'Зона визначена за вулицею, без номера будинку — перевірте склад'
        : wrongStreet
          ? `Знайдено іншу вулицю — «${streetFromDisplay(point.display_name)}», перевірте склад`
          : null,
  }
}
