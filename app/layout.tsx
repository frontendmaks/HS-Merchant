import type { Metadata } from 'next'
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className={`${geist.variable} ${geistMono.variable} antialiased bg-zinc-950`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <MainWrapper>{children}</MainWrapper>
        </div>
      </body>
    </html>
  )
}
