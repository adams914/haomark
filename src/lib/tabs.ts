/**
 * 多标签页状态管理（v2.0）。
 *
 * 设计：
 * - useReducer 集中管 tabs 数组 + activeTabId（强关联操作走 reducer）
 * - 全局 UI 态（字号/主题/大纲开关）继续用 useState，不进 reducer
 * - 每个 tab 是独立文档态（fileName/source/filePath/dirty/viewMode/currentLine）
 * - 编辑器实例策略：每 tab 一个 CodeMirror，display:none 保活（见 LiveEditor/App）
 *
 * 边界：
 * - 同文件双开：filePath 相同 → SWITCH 到已有 tab，不新开（reducer OPEN 处理）
 * - 关闭最后一个 tab：自动开新空 tab（reducer CLOSE 保证）
 * - MAX_TABS：12，超出调用方负责提示
 */

// ViewMode 是编辑器视图模式（live/source/preview），三处共用：tabs.ts / LiveEditor.tsx / Toolbar.tsx
// 放这里定义，LiveEditor re-export 保持向后兼容
export type ViewMode = 'live' | 'source' | 'preview'

export interface Tab {
  id: string                 // 唯一标识（crypto.randomUUID() 或时间戳 fallback）
  fileName: string
  source: string
  filePath: string | null    // Tauri 真实路径，null = 未落盘（草稿）
  dirty: boolean
  viewMode: ViewMode         // 每 tab 独立
  currentLine: number        // 光标行（大纲高亮用），每 tab 独立
  openedAt: number           // 创建时间戳，LRU/排序用
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
}

export const MAX_TABS = 12

// --- Actions -----------------------------------------------------------

export type TabAction =
  | { type: 'OPEN'; tab: Tab; activate?: boolean }
  | { type: 'CLOSE'; id: string }
  | { type: 'SWITCH'; id: string }
  | { type: 'UPDATE_SOURCE'; id: string; source: string }
  | { type: 'SET_DIRTY'; id: string; dirty: boolean }
  | { type: 'SET_VIEW_MODE'; id: string; mode: ViewMode }
  | { type: 'SET_CURSOR'; id: string; line: number }
  | { type: 'SET_PATH'; id: string; path: string; name: string }
  | { type: 'REPLACE_ACTIVE'; name: string; path: string | null; content: string }
  | { type: 'HYDRATE'; tabs: Tab[]; activeId: string | null }

// --- 工具函数 ----------------------------------------------------------

/** 生成唯一 id。优先用 crypto.randomUUID，降级到时间戳+随机。 */
export function genTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建一个新 tab。 */
export function newTab(partial: Partial<Tab> = {}): Tab {
  return {
    id: genTabId(),
    fileName: partial.fileName ?? '未命名.md',
    source: partial.source ?? '',
    filePath: partial.filePath ?? null,
    dirty: partial.dirty ?? false,
    viewMode: partial.viewMode ?? 'live',
    currentLine: partial.currentLine ?? 1,
    openedAt: Date.now(),
  }
}

/** 创建初始状态：一个 welcome tab。 */
export function createInitialState(welcomeSrc: string, welcomeName = '欢迎.md'): TabsState {
  const tab = newTab({ fileName: welcomeName, source: welcomeSrc })
  return { tabs: [tab], activeTabId: tab.id }
}

/** 找 active tab。 */
export function getActiveTab(state: TabsState): Tab | null {
  if (!state.activeTabId) return null
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null
}

/** 是否有未保存的 tab（关窗检查用）。 */
export function anyDirty(state: TabsState): boolean {
  return state.tabs.some((t) => t.dirty)
}

/** 列出所有未保存的 tab。 */
export function dirtyTabs(state: TabsState): Tab[] {
  return state.tabs.filter((t) => t.dirty)
}

// --- Reducer -----------------------------------------------------------

export function reducer(state: TabsState, action: TabAction): TabsState {
  switch (action.type) {
    case 'OPEN': {
      // 同文件去重：filePath 已存在某 tab → SWITCH 到它，不新开
      if (action.tab.filePath) {
        const existing = state.tabs.find((t) => t.filePath === action.tab.filePath)
        if (existing) {
          return { ...state, activeTabId: existing.id }
        }
      }
      // 超出上限：拒绝（调用方应提前提示，reducer 兜底）
      if (state.tabs.length >= MAX_TABS) return state
      const tabs = [...state.tabs, action.tab]
      return {
        tabs,
        activeTabId: action.activate === false ? state.activeTabId : action.tab.id,
      }
    }

    case 'CLOSE': {
      const idx = state.tabs.findIndex((t) => t.id === action.id)
      if (idx === -1) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      // 最后一个 tab：自动开新空 tab
      if (tabs.length === 0) {
        const fresh = newTab()
        return { tabs: [fresh], activeTabId: fresh.id }
      }
      // 如果关的是 active，切到邻居（右优先，没右切左）
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.id) {
        const neighbor = tabs[Math.min(idx, tabs.length - 1)]
        activeTabId = neighbor.id
      }
      return { tabs, activeTabId }
    }

    case 'SWITCH': {
      if (!state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, activeTabId: action.id }
    }

    case 'UPDATE_SOURCE': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, source: action.source, dirty: true } : t,
        ),
      }
    }

    case 'SET_DIRTY': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, dirty: action.dirty } : t,
        ),
      }
    }

    case 'SET_VIEW_MODE': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, viewMode: action.mode } : t,
        ),
      }
    }

    case 'SET_CURSOR': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, currentLine: action.line } : t,
        ),
      }
    }

    case 'SET_PATH': {
      // 保存后回填路径 + 文件名 + 清 dirty
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id
            ? { ...t, filePath: action.path, fileName: action.name, dirty: false }
            : t,
        ),
      }
    }

    case 'REPLACE_ACTIVE': {
      // 替换 active tab 的内容（用于"空白 active 替换"场景）
      if (!state.activeTabId) return state
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === state.activeTabId
            ? { ...t, fileName: action.name, filePath: action.path, source: action.content, dirty: false }
            : t,
        ),
      }
    }

    case 'HYDRATE': {
      // 启动时从持久化恢复
      if (action.tabs.length === 0) return state
      const activeId = action.activeId && action.tabs.some((t) => t.id === action.activeId)
        ? action.activeId
        : action.tabs[0].id
      return { tabs: action.tabs, activeTabId: activeId }
    }

    default:
      return state
  }
}

/**
 * 判断 active tab 是否"空白可替换"（用于 openOrReplace 决策）。
 * 空白 = 未落盘 + 无修改 + 内容为空或为 welcome。
 */
export function isTabBlank(tab: Tab, welcomeSrc?: string): boolean {
  if (tab.filePath !== null) return false
  if (tab.dirty) return false
  if (tab.source === '') return true
  if (welcomeSrc && tab.source === welcomeSrc) return true
  return false
}
