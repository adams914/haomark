import { useRef } from 'react'
import type { ViewMode } from './LiveEditor'
import type { Theme } from '../lib/useTheme'

interface Props {
  fileName: string
  dirty: boolean
  charCount: number
  lineCount: number
  viewMode: ViewMode
  theme: Theme
  outlineOpen: boolean
  fontSize: number
  isTauri?: boolean
  onOpenFile: (file: File) => void
  onToolbarOpen?: () => void
  onSave: () => void
  onSaveAll?: () => void
  onViewModeChange: (mode: ViewMode) => void
  onThemeChange: (t: Theme) => void
  onToggleOutline: () => void
  onFontSizeChange: (size: number) => void
  onOpenSettings: () => void
}

export default function Toolbar({
  fileName,
  dirty,
  charCount,
  lineCount,
  viewMode,
  theme,
  outlineOpen,
  fontSize,
  isTauri = false,
  onOpenFile,
  onToolbarOpen,
  onSave,
  onSaveAll,
  onViewModeChange,
  onThemeChange,
  onToggleOutline,
  onFontSizeChange,
  onOpenSettings,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开按钮：Tauri 走原生对话框，浏览器触发隐藏 <input>
  const handleOpenClick = () => {
    if (isTauri) onToolbarOpen?.()
    else inputRef.current?.click()
  }

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <button
          className={`icon-btn ${outlineOpen ? 'active' : ''}`}
          onClick={onToggleOutline}
          title="大纲（侧边栏）"
        >
          ☰
        </button>
        <span className="app-name">好记</span>
        <span className={`file-name ${dirty ? 'dirty' : ''}`} title={fileName}>
          {dirty && <span className="dirty-dot">●</span>}
          {fileName}
        </span>
      </div>

      <div className="toolbar-actions">
        <span className="counter" title="字符数 / 行数">
          {charCount.toLocaleString()} 字 · {lineCount.toLocaleString()} 行
        </span>

        {/* 视图模式 */}
        <div className="seg" role="tablist" aria-label="视图模式">
          {(['live', 'source', 'preview'] as ViewMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={viewMode === m}
              className={`seg-btn ${viewMode === m ? 'active' : ''}`}
              onClick={() => onViewModeChange(m)}
              title={
                m === 'live' ? '实时渲染（Ctrl+加粗/斜体/代码）' : m === 'source' ? '纯源码' : '只读预览'
              }
            >
              {m === 'live' ? '实时' : m === 'source' ? '源码' : '预览'}
            </button>
          ))}
        </div>

        {/* 主题切换：auto → light → dark 循环 */}
        <button
          className="icon-btn"
          onClick={() => {
            const next: Theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto'
            onThemeChange(next)
          }}
          title={`主题：${theme === 'auto' ? '跟随系统' : theme === 'light' ? '亮色' : '暗色'}`}
        >
          {theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}
        </button>

        {/* 字号 */}
        <div className="font-size-ctrl" title={`字号 ${fontSize}px`}>
          <button className="icon-btn" onClick={() => onFontSizeChange(fontSize - 1)} title="缩小">
            A−
          </button>
          <span className="font-size-val">{fontSize}</span>
          <button className="icon-btn" onClick={() => onFontSizeChange(fontSize + 1)} title="放大">
            A+
          </button>
        </div>

        <button className="btn btn-primary" onClick={onSave} disabled={!dirty} title="保存（Ctrl+S）">
          保存
        </button>
        {onSaveAll && (
          <button
            className="icon-btn"
            onClick={onSaveAll}
            title="保存全部（Ctrl+Alt+S）"
            aria-label="保存全部"
          >
            ⇩⇩
          </button>
        )}
        <button className="btn" onClick={handleOpenClick} title="打开文件">
          打开
        </button>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
        >
          ⚙
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.mdown,.txt"
          className="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpenFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
