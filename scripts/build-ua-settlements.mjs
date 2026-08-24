// Builds a gazetteer of Ukrainian settlements from the GeoNames dump so the
// app can resolve an order's oblast and pin its city on the map without any
// runtime lookup.
//
//   curl -sLO https://download.geonames.org/export/dump/UA.zip && unzip -o UA.zip
//   node scripts/build-ua-settlements.mjs UA.txt > lib/ua-settlements.json
//
// Only populated places are kept, and only their Ukrainian names — the file is
// imported on the server, never shipped to the browser.

import fs from 'node:fs'

const ADMIN1 = {
  '01': 'Черкаська',       '02': 'Чернігівська',      '03': 'Чернівецька',
  '04': 'Дніпропетровська','05': 'Донецька',          '06': 'Івано-Франківська',
  '07': 'Харківська',      '08': 'Херсонська',        '09': 'Хмельницька',
  '10': 'Кіровоградська',  '11': 'АР Крим',           '12': 'Київ',
  '13': 'Київська',        '14': 'Луганська',         '15': 'Львівська',
  '16': 'Миколаївська',    '17': 'Одеська',           '18': 'Полтавська',
  '19': 'Рівненська',      '20': 'Севастополь',       '21': 'Сумська',
  '22': 'Тернопільська',   '23': 'Вінницька',         '24': 'Волинська',
  '25': 'Закарпатська',    '26': 'Запорізька',        '27': 'Житомирська',
}

const isCyrillic = s => /^[Ѐ-ӿ][Ѐ-ӿ\s'’ʼ`\-.]*$/.test(s)

// Apostrophes and hyphens vary between sources — match on a normalised key
export const key = s => s
  .toLowerCase()
  .replace(/[''’ʼ`´]/g, "'")
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

const file = process.argv[2] ?? 'UA.txt'
const out = new Map()   // ukrainian name -> [oblast, lat, lon, population]

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const f = line.split('\t')
  if (f.length < 15) continue
  const [, name, , alternates, lat, lon, cls, , , , admin1] = f
  if (cls !== 'P') continue                 // populated places only
  const oblast = ADMIN1[admin1]
  if (!oblast) continue

  const population = Number(f[14]) || 0

  // GeoNames keeps the Cyrillic form among the alternate names
  const candidates = [name, ...(alternates ? alternates.split(',') : [])]
    .map(s => s.trim())
    .filter(s => s.length > 1 && isCyrillic(s))

  for (const c of candidates) {
    const k = key(c)
    const prev = out.get(k)
    // Same name in several oblasts — the larger settlement is the likelier match
    if (!prev || population > prev[3]) {
      out.set(k, [oblast, +(+lat).toFixed(4), +(+lon).toFixed(4), population])
    }
  }
}

const obj = {}
for (const [name, [oblast, lat, lon]] of out) obj[name] = [oblast, lat, lon]

process.stdout.write(JSON.stringify(obj))
process.stderr.write(`settlements: ${out.size}\n`)
