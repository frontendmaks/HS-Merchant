'use client'

import { useState, Suspense } from 'react'
import { deadline } from '@/lib/http'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'

function LoginForm() {
  const searchParams = useSearchParams()
  const isNewUser = searchParams.get('invited') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await deadline(supabase.auth.signInWithPassword({ email, password }), 35000)
      if (error) throw error
      // Fresh document reads the newly stored cookies and clears stale auth locks.
      window.location.assign('/')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(/timeout|timed out|fetch|network|temporar|сервіс тимчасово/i.test(message)
        ? 'Не вдалося дочекатися відповіді сервісу входу. Повторіть спробу за кілька секунд.'
        : /invalid login credentials/i.test(message) ? 'Неправильний email або пароль' : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.svg" alt="Галицька Свіжина" className="w-14 h-14 rounded-full mb-4" />
          <h1 className="text-white text-xl font-semibold">HS Merchant</h1>
          <p className="text-zinc-500 text-sm mt-1">Вхід в адмін-панель</p>
        </div>

        {searchParams.get('retry') === '1' && <p className="text-amber-400 text-sm mb-4">Перевірка сесії затрималась. Спробуйте увійти ще раз.</p>}
        {isNewUser && (
          <div className="bg-emerald-950/50 border border-emerald-800 rounded-xl px-4 py-3 text-emerald-400 text-sm text-center mb-4">
            ✓ Пароль встановлено! Тепер увійдіть зі своїми даними.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 h-11 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 h-11 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-900 rounded-lg px-3 py-2.5 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg h-11 transition-colors"
          >
            {loading ? 'Вхід...' : 'Увійти'}
          </button>
        </form>

        <p className="text-center text-zinc-600 text-xs mt-6">
          Немає доступу? Зверніться до адміністратора
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
