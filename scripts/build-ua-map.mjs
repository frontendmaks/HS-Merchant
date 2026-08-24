// Converts the TopoJSON of Ukraine's oblasts into compact SVG paths so the app
// ships no geo library and makes no runtime request for geometry.
import fs from 'node:fs'

const topo = JSON.parse(fs.readFileSync('ua.json', 'utf8'))
const obj = topo.objects.UKR_adm1
const [sx, sy] = topo.transform.scale
const [tx, ty] = topo.transform.translate

// HASC code -> how the oblast is written in Ukrainian, matching our order data
const UA = {
  'UA.CK': ['Черкаська', 'CK'],       'UA.CH': ['Чернігівська', 'CH'],
  'UA.CV': ['Чернівецька', 'CV'],     'UA.KR': ['АР Крим', 'KR'],
  'UA.DP': ['Дніпропетровська', 'DP'],'UA.DT': ['Донецька', 'DT'],
  'UA.IF': ['Івано-Франківська','IF'],'UA.KK': ['Харківська', 'KK'],
  'UA.KS': ['Херсонська', 'KS'],      'UA.KM': ['Хмельницька', 'KM'],
  'UA.KV': ['Київська', 'KV'],        'UA.KC': ['Київ', 'KC'],
  'UA.KH': ['Кіровоградська', 'KH'],  'UA.LH': ['Луганська', 'LH'],
  'UA.LV': ['Львівська', 'LV'],       'UA.MY': ['Миколаївська', 'MY'],
  'UA.OD': ['Одеська', 'OD'],         'UA.PL': ['Полтавська', 'PL'],
  'UA.RV': ['Рівненська', 'RV'],      'UA.SC': ['Севастополь', 'SC'],
  'UA.SM': ['Сумська', 'SM'],         'UA.TP': ['Тернопільська', 'TP'],
  'UA.ZK': ['Закарпатська', 'ZK'],    'UA.VI': ['Вінницька', 'VI'],
  'UA.VO': ['Волинська', 'VO'],       'UA.ZP': ['Запорізька', 'ZP'],
  'UA.ZT': ['Житомирська', 'ZT'],
}

function decodeArc(i) {
  const rev = i < 0
  const arc = topo.arcs[rev ? ~i : i]
  let x = 0, y = 0
  const pts = arc.map(([dx, dy]) => {
    x += dx; y += dy
    return [x * sx + tx, y * sy + ty]
  })
  return rev ? pts.reverse() : pts
}

const ringPoints = ring => {
  const out = []
  for (const idx of ring) {
    const pts = decodeArc(idx)
    // arcs share endpoints; drop the duplicate seam
    out.push(...(out.length ? pts.slice(1) : pts))
  }
  return out
}

const shapes = obj.geometries.map(g => ({
  hasc: g.properties.HASC_1,
  rings: (g.type === 'Polygon' ? [g.arcs] : g.arcs).flatMap(poly => poly.map(ringPoints)),
}))

// Bounds over everything, then an equal-area-ish flat projection: longitude is
// squeezed by cos(mean latitude) so Ukraine keeps its real proportions.
let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9
for (const s of shapes) for (const r of s.rings) for (const [lon, lat] of r) {
  if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon
  if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
}
const k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180)
const W = 1000
const spanX = (maxLon - minLon) * k
const spanY = maxLat - minLat
const H = Math.round(W * spanY / spanX)

const project = ([lon, lat]) => [
  ((lon - minLon) * k) / spanX * W,
  (maxLat - lat) / spanY * H,
]

const round = n => Math.round(n * 10) / 10

// Drop points that barely move the outline — keeps the payload small
function simplify(pts, tol = 0.6) {
  const out = [pts[0]]
  for (const p of pts.slice(1)) {
    const last = out[out.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol) out.push(p)
  }
  if (out.length < 3) return pts
  return out
}

const regions = shapes.map(s => {
  const d = s.rings.map(r => {
    const pts = simplify(r.map(project)).map(([x, y]) => `${round(x)},${round(y)}`)
    return 'M' + pts.join('L') + 'Z'
  }).join('')
  const [name, code] = UA[s.hasc] ?? [s.hasc, s.hasc]
  return { code, name, d }
}).sort((a, b) => a.name.localeCompare(b.name, 'uk'))

const ts = `// Generated from a simplified TopoJSON of Ukraine's oblasts.
// Regenerate with scripts/build-ua-map.mjs — do not hand-edit the paths.

export interface OblastShape {
  /** Short stable key, e.g. 'KC' for Київ */
  code: string
  /** Ukrainian name exactly as the analytics data keys it */
  name: string
  /** SVG path in the VIEWBOX coordinate space below */
  d: string
}

export const MAP_VIEWBOX = '0 0 ${W} ${H}'

export const OBLAST_SHAPES: OblastShape[] = ${JSON.stringify(regions, null, 2)}
`

fs.writeFileSync('ua-oblasts.ts', ts)
console.log(`regions: ${regions.length}`)
console.log(`viewBox: 0 0 ${W} ${H}`)
console.log(`output:  ${(ts.length / 1024).toFixed(1)} KB`)
console.log('names:', regions.map(r => r.name).join(', '))
