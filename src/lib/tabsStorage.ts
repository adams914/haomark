/**
 * Tab 列表持久化（v2.0）。
 *
 * 桌面端：Tauri app data 目录的 tabs.json（原子写，防崩溃）。
 * 浏览器端：localStorage（受配额限制，会截断超大内容）。
 *
 * 存什么：
 * - 文档元信息（fileName / filePath / viewMode / currentLine / dirty）
 * - dirty tab 的 source（崩溃恢复用）
 * - 已保存 tab 不存 source（启动时从磁盘重读，避免与磁盘版本不一致）
 */

import type { Tab } from './tabs'
import type { ViewMode } from './tabs'
import { isTauri } from './fileIO'

/** 持久化的 tab 结构（比运行时 Tab 精简，去掉 id 重新生成）。 */
export interface PersistedTab {
  fileName: string
  filePath: string | null
  viewMode: ViewMode
  currentLine: number
  dirty: boolean
  source?: string  // 仅 dirty tab 存（崩溃恢复），已保存 tab 不存
  openedAt: number
}

export interface PersistedState {
  version: 1
  tabs: PersistedTab[]
  activeTabId: string | null  // 注：id 会重新生成，这里只是占位
  savedAt: number
}

const BROWSER_KEY = 'md-viewer-tabs'

/** 加载持久化状态。返回 null 表示无历史或加载失败。 */
export async function loadPersistedTabs(): Promise<PersistedTab[] | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const json = await invoke<string>('load_tabs')
      return parseTabsJson(json)
    } catch (err) {
      console.error('加载 tab 状态失败：', err)
      return null
    }
  }
  // 浏览器
  try {
    const raw = localStorage.getItem(BROWSER_KEY)
    if (!raw) return null
    return parseTabsJson(raw)
  } catch {
    return null
  }
}

/** 保存 tab 列表（debounce 由调用方控制）。 */
// activeTabId 参数保留作未来扩展（多窗口场景），当前不用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function savePersistedTabs(tabs: Tab[], _activeTabId: string | null): Promise<void> {
  // 已保存的 tab（filePath 非 null 且未脏）不存 source——启动时从磁盘重读
  const persisted: PersistedTab[] = tabs.map((t) => {
    const base: PersistedTab = {
      fileName: t.fileName,
      filePath: t.filePath,
      viewMode: t.viewMode,
      currentLine: t.currentLine,
      dirty: t.dirty,
      openedAt: t.openedAt,
    }
    // dirty 或未落盘的草稿，必须存 source（否则崩溃丢失）
    if (t.dirty || t.filePath === null) {
      base.source = t.source
    }
    return base
  })

  const state: PersistedState = {
    version: 1,
    tabs: persisted,
    activeTabId: null, // 不存 id，启动时重新生成
    savedAt: Date.now(),
  }
  const json = JSON.stringify(state)

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_tabs', { json })
    } catch (err) {
      console.error('保存 tab 状态失败：', err)
    }
  } else {
    try {
      localStorage.setItem(BROWSER_KEY, json)
    } catch {
      // 配额满，静默失败
    }
  }
}

function parseTabsJson(json: string): PersistedTab[] | null {
  try {
    const parsed = JSON.parse(json) as PersistedState | PersistedTab[]
    // 兼容两种格式：v2.0 的 { version, tabs } 或裸数组
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.tabs)) return parsed.tabs
    return null
  } catch {
    return null
  }
}
