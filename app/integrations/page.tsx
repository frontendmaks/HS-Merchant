import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { CONNECTORS, loadIntegrations, maskSecret } from '@/lib/integrations'
import IntegrationCard from './IntegrationCard'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const role = await getCurrentRole()
  if (!canAccess('integrations', role)) redirect('/')

  const service = createServiceClient()
  const saved = await loadIntegrations(service)

  const [{ count: subscribers }, { data: recent }] = await Promise.all([
    service.from('viber_subscribers')
      .select('viber_id', { count: 'exact', head: true }).is('unsubscribed_at', null),
    service.from('customer_messages')
      .select('channel, event, sent_at, error, created_at')
      .order('created_at', { ascending: false }).limit(5),
  ])

  const cards = CONNECTORS.map(c => {
    const row = saved.get(c.key)
    return {
      key: c.key,
      title: c.title,
      what: c.what,
      managed: c.managed,
      fields: c.fields ?? [],
      connected: c.managed === 'env' ? !!c.present?.() : !!row?.enabled,
      // Токен є, але зв'язок вимкнено — окремий стан, бо повернути його
      // можна одним рухом, а виглядало б це як «не під'єднано»
      dormant: c.managed === 'panel' && !row?.enabled
        && !!(row?.config ?? {})[c.fields?.[0]?.name ?? 'token'],
      status: row?.status
        ?? (c.managed === 'env'
          ? (c.present?.() ? 'налаштовано у змінних оточення' : 'не налаштовано')
          : null),
      checkedAt: row?.checked_at ?? null,
      masked: c.fields?.length
        ? maskSecret((row?.config ?? {})[c.fields[0].name])
        : null,
    }
  })

  return (
    <div className="bg-zinc-950 text-white space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Інтеграції</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          Сервіси, з якими працює Мерчант. Частину під&apos;єднали у змінних
          оточення при розгортанні, частину можна під&apos;єднати звідси.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {cards.map(c => (
          <IntegrationCard
            key={c.key}
            card={c}
            extra={c.key === 'viber'
              ? `Підписників: ${subscribers ?? 0}`
              : null}
          />
        ))}
      </div>

      {(recent ?? []).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
            Останні сповіщення клієнтам
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(recent ?? []).map((m, i) => (
                <tr key={i} className="border-b border-zinc-800/60">
                  <td className="px-4 py-2 text-zinc-400 text-xs">{m.channel as string}</td>
                  <td className="px-4 py-2 text-zinc-300 text-xs">{(m.event as string) ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">
                    {m.sent_at
                      ? <span className="text-emerald-500">надіслано</span>
                      : <span className="text-amber-500">{(m.error as string) ?? 'не надіслано'}</span>}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 text-xs">
                    {new Date(m.created_at as string).toLocaleString('uk-UA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
