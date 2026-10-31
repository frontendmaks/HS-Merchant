import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import MainWrapper from '@/components/MainWrapper'
import { isTest } from '@/lib/env-mode'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  /* Вкладку видно у списку поруч із продакшн-вкладкою — там і має бути
     видно, котра з них котра, ще до того, як у неї зазирнули */
  title: isTest ? 'ТЕСТ · HS Merchant' : 'HS Merchant',
  description: 'Агрегатор XML фідів для маркетплейсів',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

// Tints the mobile browser chrome to match the sidebar instead of leaving a
// white band above a dark page.
export const viewport: Viewport = {
  themeColor: '#18181b',
  // Both, so form controls and the browser's own chrome follow the theme the
  // page picked rather than being pinned to the dark one
  colorScheme: 'dark light',
}

/**
 * Applies the saved theme before the first paint.
 *
 * React cannot do this: the server renders without knowing what this browser
 * chose, so the page would draw dark and correct itself a moment later — the
 * white flash every themed site is judged by. Runs inline, ahead of the body.
 */
const applyTheme = `
try {
  var t = localStorage.getItem('hs-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} antialiased bg-zinc-950`}>
        {/*
          * Смуга через весь екран, а не значок у кутку.
          *
          * Два вікна поруч виглядають однаково, і помилитись вікном —
          * означає скасувати справжнє замовлення, думаючи, що воно
          * вигадане. Смугу згори видно на будь-якій сторінці, на будь-якому
          * прокручуванні й боковим зором.
          */}
        {isTest && (
          <div className="sticky top-0 z-[2000] bg-amber-500 text-amber-950 text-center
                          text-xs font-semibold py-1 px-3 tracking-wide">
            ТЕСТОВЕ СЕРЕДОВИЩЕ · назовні нічого не йде: ні угоди в Бітрікс,
            ні бланки на склади, ні ТТН, ні маркетплейси
          </div>
        )}
        <div className="flex min-h-screen">
          <Sidebar />
          <MainWrapper>{children}</MainWrapper>
        </div>
      </body>
    </html>
  )
}
