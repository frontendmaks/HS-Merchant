export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { currentActor } from '@/lib/order-events'
import { canWriteNews, seesAllNews } from '@/lib/news'
import NewsClient from './NewsClient'

export default async function NewsPage() {
  const role = await getCurrentRole()
  if (!canAccess('news', role)) redirect('/')

  const actor = await currentActor()
  const supabase = createServiceClient()

  let query = supabase
    .from('news')
    .select('*, author:profiles!news_author_id_fkey(full_name, email)')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  // Management reads everything, drafts included — someone has to be able to
  // answer "what did we tell the team". Everyone else sees what was published
  // and addressed to them.
  if (!seesAllNews(role)) {
    query = query.eq('status', 'published').contains('audience', [role ?? ''])
  }

  const [{ data: news }, { data: reads }] = await Promise.all([
    query,
    supabase.from('news_reads').select('news_id').eq('user_id', actor?.id ?? ''),
  ])

  return (
    <NewsClient
      news={news ?? []}
      readIds={(reads ?? []).map(r => r.news_id as string)}
      canWrite={canWriteNews(role)}
      role={role}
    />
  )
}
