import { useEffect, useState, type CSSProperties } from 'react'
import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components'

export function useSystemTheme(): { theme: Theme; dark: boolean } {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(mq.matches)
  useEffect(() => {
    const h = (e: MediaQueryListEvent): void => setDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [mq])
  return { theme: dark ? webDarkTheme : webLightTheme, dark }
}

/**
 * Windows'ta pencere Mica malzemesi kullanır; arka plan şeffaf kalmalı.
 * Diğer platformlarda Mica'yı taklit eden yumuşak bir degrade çizilir.
 */
export function appBackground(platform: string, dark: boolean): string {
  if (platform === 'win32' || platform === 'darwin') return 'transparent'
  return dark
    ? 'radial-gradient(1200px 600px at 10% -10%, #2b2f3a 0%, transparent 60%), radial-gradient(900px 500px at 110% 10%, #2a2533 0%, transparent 55%), #1f1f1f'
    : 'radial-gradient(1200px 600px at 10% -10%, #e3ecfa 0%, transparent 60%), radial-gradient(900px 500px at 110% 10%, #f1e9f7 0%, transparent 55%), #f3f3f3'
}

/** Acrylic benzeri yarı saydam katman (kartlar, yan panel) */
export function acrylic(dark: boolean): CSSProperties {
  return {
    background: dark ? 'rgba(44,44,44,0.72)' : 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(30px) saturate(125%)',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`
  }
}
