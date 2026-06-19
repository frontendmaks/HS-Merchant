import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className={`${geist.variable} ${geistMono.variable} antialiased bg-zinc-950`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-60 p-4 min-w-0 overflow-x-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
