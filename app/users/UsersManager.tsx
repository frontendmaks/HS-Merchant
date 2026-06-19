'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'super_admin' | 'admin' | 'operator' | 'viewer'
  is_active: boolean
  created_at: string
  invite_pending?: boolean
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin: { label: 'Супер адмін',  color: 'bg-yellow-900/60 text-yellow-300' },
  admin:       { label: 'Адміністратор', color: 'bg-red-900/60 text-red-300' },
  operator:    { label: 'Оператор',      color: 'bg-blue-900/60 text-blue-300' },
  viewer:      { label: 'Глядач',        color: 'bg-zinc-700 text-zinc-300' },
}

export default function UsersManager({ users: initial, currentUserId, currentRole }: {
  users: Profile[]
  currentUserId: string
  currentRole: string
}) {
  const router = useRouter()
  const [users, setUsers] = useState(initial)
  const isSuperAdmin = currentRole === 'super_admin'
  // Admin can only manage users with role < admin (operator, viewer)
  const canManage = (targetRole: string) =>
    isSuperAdmin || (currentRole === 'admin' && !['super_admin', 'admin'].includes(targetRole))

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<'super_admin' | 'admin' | 'operator' | 'viewer'>('operator')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    setInviteSuccess('')
    setInviteLoading(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, full_name: inviteName, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Помилка')
      setInviteSuccess(`Запрошення відправлено на ${inviteEmail}`)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('operator')
      setShowInvite(false)
      router.refresh()
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : String(e))
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleRoleChange(id: string, role: string) {
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role }),
    })
    if (res.ok) {
      setUsers(u => u.map(x => x.id === id ? { ...x, role: role as Profile['role'] } : x))
    }
  }

  async function handleToggleActive(id: string, is_active: boolean) {
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active }),
    })
    if (res.ok) {
      setUsers(u => u.map(x => x.id === id ? { ...x, is_active } : x))
    }
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Видалити користувача ${email}? Цю дію не можна відмінити.`)) return
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setUsers(u => u.filter(x => x.id !== id))
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Користувачі</h1>
          <p className="text-zinc-400 text-sm mt-0.5">Управління доступом команди</p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteError(''); setInviteSuccess('') }}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Запросити користувача
        </button>
      </div>

      {/* Success banner */}
      {inviteSuccess && (
        <div className="bg-emerald-950/50 border border-emerald-800 rounded-xl px-4 py-3 text-emerald-400 text-sm">
          ✓ {inviteSuccess}
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Запросити нового користувача</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Email *</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                  placeholder="user@company.com"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">ПІБ</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Іванов Іван"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Роль *</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                >
                  {isSuperAdmin && <option value="super_admin">Супер адміністратор</option>}
                  {isSuperAdmin && <option value="admin">Адміністратор</option>}
                  <option value="operator">Оператор</option>
                  <option value="viewer">Глядач</option>
                </select>
              </div>
            </div>

            {inviteError && (
              <div className="text-red-400 text-sm">{inviteError}</div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={inviteLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {inviteLoading ? 'Надсилання...' : 'Надіслати запрошення'}
              </button>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
              >
                Скасувати
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Role legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(ROLE_LABELS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.color}`}>{v.label}</span>
            <span className="text-zinc-500 text-xs">
              {k === 'super_admin' ? '— необмежений доступ, підтримка системи' :
               k === 'admin'       ? '— управління командою та налаштування' :
               k === 'operator'    ? '— робота із замовленнями та синками' :
                                     '— тільки перегляд'}
            </span>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="text-left px-4 py-3">Користувач</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Роль</th>
              <th className="text-left px-4 py-3">Статус</th>
              <th className="text-left px-4 py-3">Доданий</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {users.map(user => {
              const isMe = user.id === currentUserId
              const role = ROLE_LABELS[user.role]
              return (
                <tr key={user.id} className="hover:bg-zinc-800/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold shrink-0">
                        {(user.full_name || user.email).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white text-sm font-medium">
                          {user.full_name || '—'}
                          {isMe && <span className="ml-2 text-xs text-zinc-500">(ви)</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-sm">{user.email}</td>
                  <td className="px-4 py-3">
                    {isMe || !canManage(user.role) ? (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${role.color}`}>
                        {role.label}
                      </span>
                    ) : (
                      <select
                        value={user.role}
                        onChange={e => handleRoleChange(user.id, e.target.value)}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                      >
                        {isSuperAdmin && <option value="super_admin">Супер адміністратор</option>}
                        {isSuperAdmin && <option value="admin">Адміністратор</option>}
                        <option value="operator">Оператор</option>
                        <option value="viewer">Глядач</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.invite_pending ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded bg-amber-950/60 text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Запрошений
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded ${
                        user.is_active ? 'bg-emerald-950/60 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                        {user.is_active ? 'Активний' : 'Деактивований'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString('uk-UA')}
                  </td>
                  <td className="px-4 py-3">
                    {!isMe && canManage(user.role) && (
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => handleToggleActive(user.id, !user.is_active)}
                          className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                        >
                          {user.is_active ? 'Деактивувати' : 'Активувати'}
                        </button>
                        <button
                          onClick={() => handleDelete(user.id, user.email)}
                          className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                        >
                          Видалити
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
