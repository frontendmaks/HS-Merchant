/**
 * Фід для Prom.ua.
 *
 * Через API Prom товар створити не можна — довідка каже прямо:
 * «додати товари вручну або через імпорт; оновлювати існуючі також
 * можна за API». Тож асортимент заводить цей фід, а API лишається на
 * ціни, залишки й замовлення.
 *
 * Prom забирає його сам за посиланням, раз на чотири години.
 * Формат — YML, описаний у довідці Prom; від Rozetka він різниться
 * достатньо, щоб не намагатись обійтись одним генератором:
 *   · `<oldprice>` замість `<price_old>` — саме він малює перекреслену
 *     ціну, і знижка живе 45 днів;
 *   · `selling_type="r"` — роздріб, інакше товар просять «від N штук»;
 *   · українська мова вмикається парою: `name_ua` оновиться лише тоді,
 *     коли заповнено й `description_ua`, і навпаки. Тому віддаємо
 *     обидва або жодного.
 */
import { promoFor, oldPriceFor } from '@/lib/price-promo'
import { basePrice, roundOffer, categoryFor } from '@/lib/price-category'
import {
  calcMarketplacePrice, minWeightLabel, escapeXml, stripControlChars, offerStock,
} from '@/lib/feed-xml'
import { descriptionFor, attrsFor, nameFor } from '@/lib/product-content'

/** Prom бере від одного до десяти знімків на товар. */
const usablePicture = (url: string) => /^https?:\/\//i.test(url)

/** Стабільний числовий id групи з її назви: Prom вимагає id, а в нас
 *  категорії звуться словами. Той самий рядок завжди дає те саме число,
 *  тож групи не перестворюються щоімпорту. */
export function groupId(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 900000000 + 1000
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generatePromYML(feed: any): {
  xml: string; offersCount: number; errorsCount: number; errors: string[]
} {
  const errors: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)

  const groups = new Map<number, string>()
  const offers: string[] = []

  for (const fp of active) {
    const p = fp.product
    const attrs = attrsFor(p)

    const offerId = String(p.external_id ?? '').trim()
    if (!offerId) {
      errors.push(`Пропущено — немає коду товару: ${nameFor(p) || p.id}`)
      continue
    }

    const weightLabel = minWeightLabel(attrs)
    const baseName = String(fp.custom_name ?? nameFor(p) ?? '').trim()
    const name = (weightLabel ? `${baseName}, ${weightLabel}` : baseName).slice(0, 255)
    if (!name) { errors.push(`Немає назви: ${offerId}`); continue }

    const { price: base } = basePrice(p, fp, feed.pricing)
    const offer = fp.custom_price ? base : (calcMarketplacePrice(base, attrs) ?? base)
    const price = roundOffer(offer, categoryFor(fp, feed.pricing))
    if (!(price > 0)) { errors.push(`Немає ціни: ${name}`); continue }

    /* Стара ціна — справжня знижка або намальована, та, що вища */
    const realOld = p.price_old && Number(p.price_old) > Number(p.price)
      ? (calcMarketplacePrice(Number(p.price_old), attrs) ?? Number(p.price_old))
      : null
    const oldRaw = oldPriceFor(price, realOld, promoFor(feed.promos ?? [], p))
    const oldPrice = oldRaw && oldRaw > price ? oldRaw : null

    const group = String(p.category_name ?? 'Інше').trim() || 'Інше'
    const gid = groupId(group)
    groups.set(gid, group)

    const raw = Number(fp.custom_stock ?? p.stock ?? 0)
    const { available, quantity } = offerStock(p.status, raw)
    const stock = Math.max(0, Math.floor(quantity ?? 0))

    const pictures = ((p.images as string[]) ?? []).filter(usablePicture).slice(0, 10)
    const description = stripControlChars(descriptionFor(p)).slice(0, 50_000)

    /*
     * Опис обов'язковий, і порожній рядок Prom не бере. Якщо опису
     * немає — ставимо назву: картка без опису не імпортується зовсім,
     * а це гірше за коротку.
     */
    const text = description || name

    const params: string[] = []
    for (const [key, value] of Object.entries(attrs)) {
      const v = String(value ?? '').trim()
      /* Службові поля фасовки покупцю ні про що не кажуть */
      if (!v || ['Одиниця', 'Мін', 'Крок', 'Вага шт'].includes(key)) continue
      params.push(`      <param name="${escapeXml(key)}">${escapeXml(v)}</param>`)
    }

    offers.push([
      `    <offer id="${escapeXml(offerId)}" available="${available}" selling_type="r">`,
      `      <name>${escapeXml(name)}</name>`,
      `      <name_ua>${escapeXml(name)}</name_ua>`,
      `      <categoryId>${gid}</categoryId>`,
      `      <price>${price}</price>`,
      oldPrice ? `      <oldprice>${oldPrice}</oldprice>` : '',
      `      <currencyId>${p.currency || 'UAH'}</currencyId>`,
      `      <quantity_in_stock>${stock}</quantity_in_stock>`,
      ...pictures.map(u => `      <picture>${escapeXml(u)}</picture>`),
      p.brand ? `      <vendor>${escapeXml(String(p.brand))}</vendor>` : '',
      p.sku ? `      <vendorCode>${escapeXml(String(p.sku))}</vendorCode>` : '',
      `      <description><![CDATA[${text}]]></description>`,
      `      <description_ua><![CDATA[${text}]]></description_ua>`,
      ...params,
      `    </offer>`,
    ].filter(Boolean).join('\n'))
  }

  const categoriesXml = [...groups.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'uk'))
    .map(([id, title]) => `      <category id="${id}">${escapeXml(title)}</category>`)
    .join('\n')

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${stamp}">
  <shop>
    <name>Галицька Свіжина</name>
    <company>Галицька Свіжина</company>
    <url>https://halytska-svizhyna.ua</url>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <categories>
${categoriesXml}
    </categories>
    <offers>
${offers.join('\n')}
    </offers>
  </shop>
</yml_catalog>`

  return { xml, offersCount: offers.length, errorsCount: errors.length, errors }
}
