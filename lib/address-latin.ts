/**
 * Латиниця в адресі → кирилиця.
 *
 * Частина адрес із сайту приходить латиницею: «Roztochchya St»,
 * «Szczyrecka», «Yahidna St». Геокодер знає ці вулиці українськими назвами й
 * латинських не впізнає зовсім, тож перекладаємо назад за звучанням. Переклад
 * грубий і для показу людині не годиться — він існує лише щоб було що
 * спитати в геокодера.
 */

/** Довші сполучення — першими, інакше «sz» з'їсть «szcz». */
const PAIRS: [string, string][] = [
  ['szcz', 'щ'], ['shch', 'щ'], ['sch', 'щ'],
  ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'],
  ['sz', 'ш'], ['cz', 'ч'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'є'], ['yi', 'ї'],
  ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['d', 'д'], ['e', 'е'], ['f', 'ф'],
  ['g', 'г'], ['h', 'г'], ['i', 'і'], ['j', 'й'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'],
  ['y', 'и'], ['z', 'з'],
]

/** Польські й англійські хвости, які в українській звучать інакше. */
const ENDINGS: [RegExp, string][] = [
  [/цка$/u, 'цька'],
  [/ска$/u, 'ська'],
  [/цки$/u, 'цький'],
]

const LATIN = /[a-z]/i

export const hasLatin = (text: string) => LATIN.test(text)

function word(raw: string): string {
  if (!LATIN.test(raw)) return raw
  // «St», «vul» — службові слова, яких у запиті краще не мати
  if (/^(st|str|street|vul|ul|ave|avenue)\.?$/i.test(raw)) return ''

  let rest = raw.toLowerCase()
  let out = ''
  outer: while (rest.length) {
    for (const [lat, cyr] of PAIRS) {
      if (rest.startsWith(lat)) { out += cyr; rest = rest.slice(lat.length); continue outer }
    }
    out += rest[0]
    rest = rest.slice(1)
  }
  for (const [pattern, replacement] of ENDINGS) out = out.replace(pattern, replacement)

  return out.charAt(0).toUpperCase() + out.slice(1)
}

export const toCyrillic = (text: string) =>
  text.split(/(\s+|,)/).map(part => (/^\s+$|^,$/.test(part) ? part : word(part)))
    .join('').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()
