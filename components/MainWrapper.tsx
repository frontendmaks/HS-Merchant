'use client'
import { usePathname } from 'next/navigation'

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isAuth = path === '/login' || path === '/set-password'

  // Below lg the sidebar is an overlay drawer, so the content keeps the full
  // width and only clears the fixed 56px mobile top bar. The offset is a margin
  // rather than padding so it cannot collide with the padding scale below.
  const appChrome = 'mt-14 lg:mt-0 lg:ml-60 p-3 sm:p-4 lg:p-6'

  return (
    <main className={`flex-1 min-w-0 overflow-x-hidden ${isAuth ? '' : appChrome}`}>
      {children}
    </main>
  )
}
