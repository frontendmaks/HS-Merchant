import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import MainWrapper from '@/components/MainWrapper'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'HS Merchant',
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
        <div className="flex min-h-screen">
          <Sidebar />
          <MainWrapper>{children}</MainWrapper>
        </div>
      </body>
    </html>
  )
}
