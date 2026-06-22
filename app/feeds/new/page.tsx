import { createServiceClient } from '@/lib/supabase/service'
import NewFeedForm from './NewFeedForm'

export const dynamic = 'force-dynamic'

export default async function NewFeedPage() {
  const supabase = createServiceClient()
  const { data: marketplaces } = await supabase.from('marketplaces').select('id, name, slug').order('name')

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Новий фід</h1>
        <p className="text-zinc-500 text-sm mt-1">Налаштуйте та збережіть — потім додасте товари</p>
      </div>
      <NewFeedForm marketplaces={marketplaces ?? []} />
    </div>
  )
}
