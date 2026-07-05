import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'md-viewer-theme'

/** 读取存储的主题，默认 auto（跟随系统） */
function getStoredTheme(): Theme {
  const t = localStorage.getItem(STORAGE_KEY)
  return t === 'light' || t === 'dark' || t === 'auto' ? t : 'auto'
}

/** 计算当前实际生效的主题（auto → 根据系统） */
function resolveEffective(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/** 把生效主题应用到 <html data-theme> */
function applyTheme(effective: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', effective)
}

/** 动态切换 highlight.js 主题样式表 */
function applyHighlightTheme(effective: 'light' | 'dark') {
  const id = 'hljs-theme'
  const existing = document.getElementById(id) as HTMLLinkElement | null
  const href = effective === 'dark'
    ? 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css'
    : 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css'
  if (existing) {
    existing.href = href
  } else {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  // 应用 + 监听系统主题变化
  useEffect(() => {
    const effective = resolveEffective(theme)
    applyTheme(effective)
    applyHighlightTheme(effective)

    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => {
        const eff = resolveEffective('auto')
        applyTheme(eff)
        applyHighlightTheme(eff)
      }
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t)
    setThemeState(t)
  }, [])

  return { theme, setTheme }
}
