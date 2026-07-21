import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import LiveEditor, { type LiveEditorHandle } from './components/LiveEditor'
import MarkdownView from './components/MarkdownView'
import DropZone from './components/DropZone'
import Outline from './components/Outline'
import RecentMenu from './components/RecentMenu'
import TabBar from './components/TabBar'
import Toast, { showToast } from './components/Toast'
import {
  isTauri,
  readFileAsText,
  saveTextAsFile,
  tauriOpenFile,
  tauriSaveFile,
  tauriTakeStartupFile,
  tauriLoadFilePath,
} from './lib/fileIO'
import { useTheme } from './lib/useTheme'
import { addRecent, type RecentFile } from './lib/recentFiles'
import { updateWindowTitle } from './lib/windowTitle'
import {
  reducer,
  newTab,
  createInitialState,
  getActiveTab,
  anyDirty,
  dirtyTabs,
  isTabBlank,
  MAX_TABS,
  type Tab,
} from './lib/tabs'
import { loadPersistedTabs, savePersistedTabs } from './lib/tabsStorage'
import welcomeSrc from './samples/welcome.md?raw'

const FONT_KEY = 'md-viewer-fontsize'

export default function App() {
  // === 多 tab 状态（reducer 集中管理）===
  // 初始用 welcome；启动后异步 hydrate 持久化的 tab 列表（覆盖初始）
  const [tabs, dispatch] = useReducer(reducer, welcomeSrc, (src) => createInitialState(src))
  // 标记是否已 hydrate（避免没加载完就保存覆盖历史）
  const hydratedRef = useRef(false)

  // === 全局 UI 态（视图偏好，所有 tab 共享）===
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(FONT_KEY)) || 15)
  const [recentKey, setRecentKey] = useState(0)
  const { theme, setTheme } = useTheme()

  // === 临时态 ===
  const [confirmAction, setConfirmAction] = useState<
    | { kind: 'close-window' }
    | { kind: 'close-tab'; tabId: string; fileName: string }
    | null
  >(null)

  // === refs（避免闭包陷阱 + CodeMirror 实例字典）===
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const editorRefs = useRef<Map<string, LiveEditorHandle>>(new Map())
  const startedRef = useRef(false)

  const activeTab = getActiveTab(tabs)
  const activeId = tabs.activeTabId

  // --- 加载文件路径到 active tab（或新开 tab）---
  const openOrReplace = useCallback(
    (file: { path: string | null; name: string; content: string }) => {
      const cur = tabsRef.current
      // 1. 同文件去重：已开过就切过去
      if (file.path) {
        const existing = cur.tabs.find((t) => t.filePath === file.path)
        if (existing) {
          dispatch({ type: 'SWITCH', id: existing.id })
          return
        }
      }
      // 2. active 空白（未落盘+未脏）→ 替换
      const active = getActiveTab(cur)
      if (active && isTabBlank(active, welcomeSrc)) {
        dispatch({
          type: 'REPLACE_ACTIVE',
          name: file.name,
          path: file.path,
          content: file.content,
        })
        return
      }
      // 3. 上限检查
      if (cur.tabs.length >= MAX_TABS) {
        showToast(`已达 ${MAX_TABS} 个标签上限，请先关闭一些`, 'error')
        return
      }
      // 4. 新开 tab
      dispatch({
        type: 'OPEN',
        tab: newTab({ fileName: file.name, source: file.content, filePath: file.path }),
      })
    },
    [],
  )

  const loadPath = useCallback(
    async (path: string) => {
      try {
        const res = await tauriLoadFilePath(path)
        if (res) openOrReplace(res)
      } catch (err) {
        console.error(err)
        showToast(`打开失败：${err}`, 'error')
      }
    },
    [openOrReplace],
  )

  // === 启动：双击启动文件 + 单实例转发 + 关闭请求 ===
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // 先尝试 hydrate 持久化的 tab 列表（启动恢复）
    ;(async () => {
      const persisted = await loadPersistedTabs()
      if (persisted && persisted.length > 0) {
        // 重建 Tab[]：对已保存的 tab（有 filePath 非 dirty），从磁盘重读 source
        const rebuilt: Tab[] = []
        for (const p of persisted) {
          let source = p.source
          // 已保存且无 source 缓存 → 从磁盘读
          if (source === undefined && p.filePath && isTauri()) {
            try {
              const { invoke } = await import('@tauri-apps/api/core')
              source = await invoke<string>('read_file', { path: p.filePath })
            } catch {
              // 文件可能已被删除/移动，跳过这个 tab
              continue
            }
          }
          rebuilt.push({
            id: cryptoRandomId(),
            fileName: p.fileName,
            source: source ?? '',
            filePath: p.filePath,
            dirty: p.dirty,
            viewMode: p.viewMode,
            currentLine: p.currentLine,
            openedAt: p.openedAt,
          })
        }
        if (rebuilt.length > 0) {
          dispatch({ type: 'HYDRATE', tabs: rebuilt, activeId: null })
        }
      }
      hydratedRef.current = true
    })()

    if (!isTauri()) return

    tauriTakeStartupFile()
      .then((res) => {
        if (res) openOrReplace(res)
      })
      .catch((err) => {
        console.error(err)
        showToast(`启动文件加载失败：${err}`, 'error')
      })

    let unlistenOpen: (() => void) | undefined
    let unlistenClose: (() => void) | undefined
    ;(async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenOpen = await listen<string>('open-file', (e) => {
        if (e.payload) loadPath(e.payload)
      })
      unlistenClose = await listen('close-requested', () => {
        // 扫所有 tab 的 dirty
        if (anyDirty(tabsRef.current)) {
          setConfirmAction({ kind: 'close-window' })
        } else {
          void destroyMainWindow()
        }
      })
    })()

    return () => {
      unlistenOpen?.()
      unlistenClose?.()
    }
  }, [openOrReplace, loadPath])

  // === tabs 变化时：debounce 保存（防崩溃 + 会话恢复）===
  useEffect(() => {
    if (!hydratedRef.current) return  // hydrate 完成前不保存，避免覆盖历史
    const t = setTimeout(() => {
      void savePersistedTabs(tabs.tabs, tabs.activeTabId)
    }, 1000)  // 1s debounce，避免每次按键都写盘
    return () => clearTimeout(t)
  }, [tabs])

  // === 应用退出前：同步保存一次（尽最大努力）===
  useEffect(() => {
    const handler = () => {
      if (hydratedRef.current) {
        void savePersistedTabs(tabsRef.current.tabs, tabsRef.current.activeTabId)
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // === 窗口标题：跟 active tab ===
  useEffect(() => {
    if (activeTab) {
      void updateWindowTitle(activeTab.fileName, activeTab.dirty)
    }
  }, [activeTab?.fileName, activeTab?.dirty, activeId])

  // === 切 tab 时：触发 active 的 LiveEditor 重新测量（display:none → visible）===
  useEffect(() => {
    if (!activeId) return
    const handle = editorRefs.current.get(activeId)
    if (handle) {
      // 延迟一帧，等 display 切换生效
      requestAnimationFrame(() => handle.refresh())
    }
  }, [activeId])

  // === 文件操作 handlers ===
  const handleChange = useCallback(
    (tabId: string) => (v: string) => {
      dispatch({ type: 'UPDATE_SOURCE', id: tabId, source: v })
    },
    [],
  )

  const handleCursorLine = useCallback(
    (tabId: string) => (line: number) => {
      dispatch({ type: 'SET_CURSOR', id: tabId, line })
    },
    [],
  )

  const handleOpenFile = useCallback(
    async (file: File) => {
      try {
        const content = await readFileAsText(file)
        openOrReplace({ path: null, name: file.name, content })
      } catch (err) {
        console.error(err)
        showToast(`读取失败：${file.name}`, 'error')
      }
    },
    [openOrReplace],
  )

  const handleToolbarOpen = useCallback(async () => {
    if (!isTauri()) return
    try {
      const res = await tauriOpenFile()
      if (res) openOrReplace(res)
    } catch (err) {
      console.error(err)
      showToast(`打开失败：${err}`, 'error')
    }
  }, [openOrReplace])

  const handleOpenRecent = useCallback(
    (f: RecentFile) => {
      openOrReplace({ path: null, name: f.name, content: f.content })
    },
    [openOrReplace],
  )

  const handleSave = useCallback(
    async (tabId?: string) => {
      const targetId = tabId ?? tabsRef.current.activeTabId
      if (!targetId) return
      const tab = tabsRef.current.tabs.find((t) => t.id === targetId)
      if (!tab) return
      try {
        const savedPath = await tauriSaveFile(tab.source, tab.filePath, tab.fileName)
        if (isTauri() && savedPath) {
          const savedName = savedPath.split(/[\\/]/).pop() ?? tab.fileName
          dispatch({ type: 'SET_PATH', id: targetId, path: savedPath, name: savedName })
          addRecent(savedName, tab.source)
          setRecentKey((k) => k + 1)
          showToast(`已保存：${savedName}`, 'success')
        } else {
          // 浏览器 fallback
          saveTextAsFile(tab.source, tab.fileName)
          addRecent(tab.fileName, tab.source)
          setRecentKey((k) => k + 1)
          showToast('已下载', 'success')
        }
      } catch (err) {
        console.error(err)
        showToast(`保存失败：${err}`, 'error')
      }
    },
    [],
  )

  // 保存所有 tab（Ctrl+Alt+S）
  const handleSaveAll = useCallback(async () => {
    const dirtyOnes = dirtyTabs(tabsRef.current)
    if (dirtyOnes.length === 0) {
      showToast('没有需要保存的文档', 'info')
      return
    }
    let ok = 0
    for (const tab of dirtyOnes) {
      try {
        await handleSave(tab.id)
        ok++
      } catch {
        // 单个失败继续下一个
      }
    }
    showToast(`已保存 ${ok}/${dirtyOnes.length} 个文档`, ok === dirtyOnes.length ? 'success' : 'error')
  }, [handleSave])

  // === Tab 操作 ===
  const handleSelectTab = useCallback((id: string) => {
    dispatch({ type: 'SWITCH', id })
  }, [])

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabsRef.current.tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.dirty) {
      // 未保存：弹确认
      setConfirmAction({ kind: 'close-tab', tabId: id, fileName: tab.fileName })
    } else {
      dispatch({ type: 'CLOSE', id })
      editorRefs.current.delete(id)
    }
  }, [])

  const handleNewTab = useCallback(() => {
    if (tabsRef.current.tabs.length >= MAX_TABS) {
      showToast(`已达 ${MAX_TABS} 个标签上限`, 'error')
      return
    }
    dispatch({ type: 'OPEN', tab: newTab() })
  }, [])

  const handleFontSize = useCallback((size: number) => {
    const clamped = Math.min(24, Math.max(11, size))
    setFontSize(clamped)
    localStorage.setItem(FONT_KEY, String(clamped))
  }, [])

  const handleJump = useCallback(
    (line: number) => {
      if (activeId) editorRefs.current.get(activeId)?.scrollToLine(line)
    },
    [activeId],
  )

  // === 关闭确认对话框 handlers ===
  const confirmSaveAndCloseWindow = useCallback(async () => {
    setConfirmAction(null)
    const dirtyOnes = dirtyTabs(tabsRef.current)
    let allOk = true
    for (const tab of dirtyOnes) {
      try {
        await handleSave(tab.id)
      } catch {
        allOk = false
      }
    }
    if (allOk) void destroyMainWindow()
    else showToast('部分文档保存失败，未关闭', 'error')
  }, [handleSave])

  const confirmDiscardAndCloseWindow = useCallback(() => {
    setConfirmAction(null)
    void destroyMainWindow()
  }, [])

  const confirmSaveAndCloseTab = useCallback(async () => {
    if (!confirmAction || confirmAction.kind !== 'close-tab') return
    const { tabId } = confirmAction
    setConfirmAction(null)
    try {
      await handleSave(tabId)
      dispatch({ type: 'CLOSE', id: tabId })
      editorRefs.current.delete(tabId)
    } catch (err) {
      showToast(`保存失败：${err}`, 'error')
    }
  }, [confirmAction, handleSave])

  const confirmDiscardAndCloseTab = useCallback(() => {
    if (!confirmAction || confirmAction.kind !== 'close-tab') return
    const { tabId } = confirmAction
    setConfirmAction(null)
    dispatch({ type: 'CLOSE', id: tabId })
    editorRefs.current.delete(tabId)
  }, [confirmAction])

  // === 统计 ===
  const { charCount, lineCount } = useMemo(() => {
    const src = activeTab?.source ?? ''
    const chars = src.length
    const lines = src === '' ? 0 : src.split(/\r\n|\r|\n/).length
    return { charCount: chars, lineCount: lines }
  }, [activeTab?.source])

  // === 渲染 ===
  return (
    <DropZone
      onFiles={(files) => {
        // 拖入多文件：依次 openOrReplace（去重 + 空白替换 + 新开）
        for (const f of files) {
          openOrReplace({ path: null, name: f.name, content: f.content })
        }
      }}
    >
      <div className="app">
        <TabBar
          tabs={tabs.tabs}
          activeId={tabs.activeTabId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          onNew={handleNewTab}
        />
        <Toolbar
          fileName={activeTab?.fileName ?? ''}
          dirty={activeTab?.dirty ?? false}
          charCount={charCount}
          lineCount={lineCount}
          viewMode={activeTab?.viewMode ?? 'live'}
          theme={theme}
          outlineOpen={outlineOpen}
          fontSize={fontSize}
          isTauri={isTauri()}
          onOpenFile={handleOpenFile}
          onToolbarOpen={handleToolbarOpen}
          onSave={() => handleSave()}
          onSaveAll={handleSaveAll}
          onViewModeChange={(mode) => {
            if (activeId) dispatch({ type: 'SET_VIEW_MODE', id: activeId, mode })
          }}
          onThemeChange={setTheme}
          onToggleOutline={() => setOutlineOpen((v) => !v)}
          onFontSizeChange={handleFontSize}
        />
        <main className="content">
          {outlineOpen && activeTab?.viewMode !== 'preview' && (
            <Outline
              source={activeTab?.source ?? ''}
              currentLine={activeTab?.currentLine ?? 1}
              onJump={handleJump}
            />
          )}
          <div className="editor-area">
            {/* 多 tab 渲染策略：所有 tab 的编辑器都挂载，用 display 切换。
                这样切 tab 不重建 CodeMirror，撤销栈/光标/scroll 自动保留。
                非活跃 tab 用 aria-hidden 标记，预览模式的 tab 用 MarkdownView 覆盖渲染。 */}
            {tabs.tabs.map((tab) => {
              const isActive = tab.id === activeId
              return (
                <div
                  key={tab.id}
                  className="tab-pane"
                  style={{ display: isActive ? 'flex' : 'none' }}
                  aria-hidden={!isActive}
                >
                  {tab.viewMode === 'preview' ? (
                    <div className="preview-scroll">
                      <div className="content-inner" style={{ fontSize: fontSize + 1 }}>
                        <MarkdownView source={tab.source} />
                      </div>
                    </div>
                  ) : (
                    <LiveEditor
                      // key 固定为 tab.id，切 tab 不重挂
                      ref={(h) => {
                        if (h) editorRefs.current.set(tab.id, h)
                        else editorRefs.current.delete(tab.id)
                      }}
                      value={tab.source}
                      onChange={handleChange(tab.id)}
                      onSave={() => handleSave(tab.id)}
                      onSaveAll={handleSaveAll}
                      viewMode={tab.viewMode}
                      fontSize={fontSize}
                      onCursorLine={handleCursorLine(tab.id)}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <RecentMenu onOpen={handleOpenRecent} refreshKey={recentKey} />
        </main>
      </div>
      <Toast />
      {confirmAction?.kind === 'close-window' && (
        <CloseWindowDialog
          tabs={dirtyTabs(tabs)}
          onCancel={() => setConfirmAction(null)}
          onSaveAll={confirmSaveAndCloseWindow}
          onDiscard={confirmDiscardAndCloseWindow}
        />
      )}
      {confirmAction?.kind === 'close-tab' && (
        <CloseTabDialog
          fileName={confirmAction.fileName}
          onCancel={() => setConfirmAction(null)}
          onSave={confirmSaveAndCloseTab}
          onDiscard={confirmDiscardAndCloseTab}
        />
      )}
    </DropZone>
  )
}

/** 销毁主窗口（关闭应用）。只在 Tauri 环境下可用。 */
async function destroyMainWindow() {
  if (!isTauri()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().destroy()
  } catch (err) {
    console.error('销毁窗口失败：', err)
  }
}

/** 生成随机 id（hydrate 时给持久化 tab 重新分配）。 */
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// === 关闭确认对话框组件 ===

function CloseWindowDialog({
  tabs,
  onCancel,
  onSaveAll,
  onDiscard,
}: {
  tabs: Tab[]
  onCancel: () => void
  onSaveAll: () => void
  onDiscard: () => void
}) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <div className="confirm-title">{tabs.length} 个文档未保存</div>
        <div className="confirm-body">
          以下文档有未保存的修改，关闭前是否保存？
          <ul className="confirm-list">
            {tabs.map((t) => (
              <li key={t.id}>{t.fileName}</li>
            ))}
          </ul>
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel}>取消</button>
          <button className="confirm-btn confirm-btn-danger" onClick={onDiscard}>不保存</button>
          <button className="confirm-btn confirm-btn-primary" onClick={onSaveAll}>全部保存</button>
        </div>
      </div>
    </div>
  )
}

function CloseTabDialog({
  fileName,
  onCancel,
  onSave,
  onDiscard,
}: {
  fileName: string
  onCancel: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <div className="confirm-title">未保存的修改</div>
        <div className="confirm-body">
          「{fileName}」有未保存的修改，关闭前是否保存？
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel}>取消</button>
          <button className="confirm-btn confirm-btn-danger" onClick={onDiscard}>不保存</button>
          <button className="confirm-btn confirm-btn-primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  )
}
