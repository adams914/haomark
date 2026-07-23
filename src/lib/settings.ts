/**
 * 应用设置（v2.0）。
 *
 * 设计：
 * - 统一 Settings 类型，分四类：基础/编辑/渲染/应用
 * - 桌面端：Tauri app data 目录的 settings.json（原子写）
 * - 浏览器端：localStorage
 * - 启动时从旧 key（md-viewer-fontsize、md-viewer-theme）迁移
 *
 * 所有设置项有默认值，新版本加字段时旧 settings 自动补默认值。
 */

import type { Theme } from './useTheme'
import { isTauri } from './fileIO'

// === 基础偏好 ===
export interface BasicSettings {
  theme: Theme              // 亮/暗/跟随系统
  fontSize: number          // 编辑器字号（px）
  fontFamily: 'system' | 'serif' | 'sans' | 'mono'  // 编辑器字体族
  contentWidth: 'narrow' | 'wide' | 'full'  // 编辑宽度：窄(780)/宽(1200)/自适应(100%)
  recentFilesLimit: number  // 最近文件数量上限（5-20）
}

// === 编辑偏好 ===
export interface EditorSettings {
  autoSaveInterval: 0 | 30 | 60 | 120  // 自动保存间隔（秒），0=关闭
  spellcheck: boolean                   // 拼写检查
  showLineNumbers: boolean              // 源码模式显示行号
  lineWrapping: boolean                 // 软换行
}

// === 渲染偏好 ===
export interface RenderSettings {
  mermaidTheme: 'auto' | 'light' | 'dark'  // 跟随应用主题或固定
  codeHighlightTheme: 'github' | 'github-dark'  // 代码高亮主题
  renderMath: boolean       // 公式渲染开关
  renderImages: boolean     // 图片渲染开关（关闭则纯文本显示 ![]）
}

// === 应用偏好 ===
export interface AppSettings {
  updateCheckInterval: 'startup' | 'daily' | 'manual'  // 检查更新频率
  updateChannel: 'stable' | 'beta'                      // 更新通道
}

export interface Settings {
  version: 1
  basic: BasicSettings
  editor: EditorSettings
  render: RenderSettings
  app: AppSettings
}

// === 默认值 ===
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  basic: {
    theme: 'auto',
    fontSize: 15,
    fontFamily: 'system',
    contentWidth: 'narrow',
    recentFilesLimit: 10,
  },
  editor: {
    autoSaveInterval: 0,
    spellcheck: false,
    showLineNumbers: true,
    lineWrapping: true,
  },
  render: {
    mermaidTheme: 'auto',
    codeHighlightTheme: 'github',
    renderMath: true,
    renderImages: true,
  },
  app: {
    updateCheckInterval: 'startup',
    updateChannel: 'stable',
  },
}

// === 加载/保存 ===

const BROWSER_KEY = 'md-viewer-settings'

/** 加载设置。无历史则返回默认值并迁移旧偏好。 */
export async function loadSettings(): Promise<Settings> {
  let raw: string | null = null

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      raw = await invoke<string>('load_settings')
    } catch (err) {
      console.error('加载设置失败：', err)
    }
  } else {
    raw = localStorage.getItem(BROWSER_KEY)
  }

  if (!raw) {
    // 无历史：尝试从旧 key 迁移
    return migrateFromLegacy()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    return mergeWithDefaults(parsed)
  } catch {
    return migrateFromLegacy()
  }
}

/** 保存设置。debounce 由调用方控制。 */
export async function saveSettings(settings: Settings): Promise<void> {
  const json = JSON.stringify(settings)
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_settings', { json })
    } catch (err) {
      console.error('保存设置失败：', err)
    }
  } else {
    try {
      localStorage.setItem(BROWSER_KEY, json)
    } catch {
      // 配额满
    }
  }
}

/** 合并用户设置与默认值（新字段补默认值）。 */
function mergeWithDefaults(partial: Partial<Settings>): Settings {
  return {
    version: 1,
    basic: { ...DEFAULT_SETTINGS.basic, ...partial.basic },
    editor: { ...DEFAULT_SETTINGS.editor, ...partial.editor },
    render: { ...DEFAULT_SETTINGS.render, ...partial.render },
    app: { ...DEFAULT_SETTINGS.app, ...partial.app },
  }
}

/** 从旧版偏好 key 迁移（md-viewer-fontsize / md-viewer-theme）。 */
function migrateFromLegacy(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS)
  try {
    const oldFont = localStorage.getItem('md-viewer-fontsize')
    if (oldFont) {
      const n = Number(oldFont)
      if (!Number.isNaN(n)) s.basic.fontSize = Math.min(24, Math.max(11, n))
    }
    const oldTheme = localStorage.getItem('md-viewer-theme')
    if (oldTheme === 'light' || oldTheme === 'dark' || oldTheme === 'auto') {
      s.basic.theme = oldTheme
    }
  } catch {
    // localStorage 不可用
  }
  return s
}
