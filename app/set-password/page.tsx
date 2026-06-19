'use client'

import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [debugMsg, setDebugMsg] = useState('')

  // Capture hash synchronously before Supabase client can potentially clear it
  const capturedHash = useRef<string>('')
  if (typeof window !== 'undefined' && !capturedHash.current) {
    capturedHash.current = window.location.hash
  }

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function init() {
      const hash = capturedHash.current || window.location.hash
      setDebugMsg(`Hash: ${hash.substring(0, 30) || 'empty'}`)

      if (hash) {
        const params = new URLSearchParams(hash.substring(1))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')

        if (accessToken && refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (data.session) {
            setReady(true)
            return
          }
          setError(sessionError?.message || 'Не вдалось встановити сесію')
          setDebugMsg(`setSession error: ${sessionError?.message}`)
          return
        }
      }

      // Fallback: check existing session
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        setReady(true)
        return
      }

      setError('Посилання недійсне або прострочене. Зверніться до адміністратора.')
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Мінімум 8 символів'); return }
    if (password !== confirm) { setError('Паролі не співпадають'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // Sign out so the user logs in fresh with their new credentials
      await supabase.auth.signOut()
      router.push('/login?invited=1')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка збереження пароля')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          {error ? (
            <>
              <div className="text-red-400 text-sm">{error}</div>
              <div className="text-zinc-600 text-xs">{debugMsg}</div>
              <a href="/login" className="text-zinc-500 text-xs hover:text-white block">← Повернутись до входу</a>
            </>
          ) : (
            <>
              <div className="text-zinc-500 text-sm">Перевірка запрошення...</div>
              <div className="text-zinc-700 text-xs">{debugMsg}</div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.svg" alt="Галицька Свіжина" className="w-14 h-14 rounded-full mb-4" />
          <h1 className="text-white text-xl font-semibold">Встановлення пароля</h1>
          <p className="text-zinc-500 text-sm mt-1 text-center">
            Вас запрошено в HS Merchant.<br />Створіть пароль для входу.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Новий пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Мінімум 8 символів"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Підтвердіть пароль</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              placeholder="Повторіть пароль"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
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
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2.5 transition-colors"
          >
            {loading ? 'Збереження...' : 'Зберегти та увійти'}
          </button>
        </form>
      </div>
    </div>
  )
}
