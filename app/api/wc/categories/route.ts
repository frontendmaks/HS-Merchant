import { NextResponse } from 'next/server'

const WC_URL = process.env.WC_URL!
const CK = process.env.WC_CONSUMER_KEY!
const CS = process.env.WC_CONSUMER_SECRET!

function wcFetch(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  return fetch(`${WC_URL}/wp-json/wc/v3${path}${sep}consumer_key=${CK}&consumer_secret=${CS}`, { cache: 'no-store' })
}

export async function GET() {
  const cats: { id: number; name: string; slug: string }[] = []
  let page = 1
  while (true) {
    const res = await wcFetch(`/products/categories?per_page=100&page=${page}&_fields=id,name,slug`)
    if (!res.ok) break
    const data = await res.json()
    if (!data.length) break
    cats.push(...data)
    page++
  }
  return NextResponse.json(cats)
}
