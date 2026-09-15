'use client'

import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'hs-theme'

/**
 * The chosen theme, remembered per browser.
 *
 * Dark is the default and stays the default: it is what the panel was
 * designed in, and it is what operators sit in front of all day. The
 * attribute goes on <html> so a stylesheet can flip the whole palette at
 * once — see app/globals.css.
 */
// Everyone reading the theme reads the same value. Two components each
// holding their own copy is how a switch ends up showing the opposite of the
// page it is sitting on.
const listeners = new Set<(t: Theme) => void>()

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('dark')

  // Read after mount: the server has no way to know what this browser chose,
  // and rendering one theme then correcting it is what causes the flash. The
  // inline script in the layout has already applied it by now.
  useEffect(() => {
    const stored = document.documentElement.dataset.theme
    if (stored === 'light' || stored === 'dark') setTheme(stored)

    listeners.add(setTheme)
    return () => { listeners.delete(setTheme) }
  }, [])

  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next
    try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode */ }
    listeners.forEach(fn => fn(next))
  }

  return [theme, choose]
}
