'use client'
import { usePathname } from 'next/navigation'

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isAuth = path === '/login' || path === '/set-password'
  return (
    <main className={`flex-1 min-w-0 overflow-x-hidden ${isAuth ? '' : 'ml-60 p-4'}`}>
      {children}
    </main>
  )
}
