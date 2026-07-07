import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import LiveEditor, { type LiveEditorHandle, type ViewMode } from './components/LiveEditor'
import MarkdownView from './components/MarkdownView'
import DropZone from './components/DropZone'
import Outline from './components/Outline'
import RecentMenu from './components/RecentMenu'
import {
  isTauri,
  readFileAsText,
  saveTextAsFile,
  tauriOpenFile,
  tauriSaveFile,
  tauriTakeStartupFile,
} from './lib/fileIO'
import { useTheme } from './lib/useTheme'
import { addRecent, type RecentFile } from './lib/recentFiles'
import { updateWindowTitle } from './lib/windowTitle'
import welcomeSrc from './samples/welcome.md?raw'

const FONT_KEY = 'md-viewer-fontsize'

export default function App() {
  const [fileName, setFileName] = useState('欢迎.md')
  const [source, setSource] = useState(welcomeSrc)
  const [filePath, setFilePath] = useState<string | null>(null) // Tauri 真实路径
  const [dirty, setDirty] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('live')
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [currentLine, setCurrentLine] = useState(1)
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(FONT_KEY)) || 15)
  const [recentKey, setRecentKey] = useState(0)
  const { theme, setTheme } = useTheme()
  const editorRef = useRef<LiveEditorHandle>(null)
  const startedRef = useRef(false)

  // Tauri 环境：启动时加载双击打开的 .md
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (!isTauri()) return
    tauriTakeStartupFile().then((res) => {
      if (res) {
        setFileName(res.name)
        setFilePath(res.path)
        setSource(res.content)
        setDirty(false)
      }
    })
  }, [])

  // 文件名 / 脏标记变化时，同步窗口标题（任务栏/Alt+Tab 显示文件名）
  useEffect(() => {
    void updateWindowTitle(fileName, dirty)
  }, [fileName, dirty])

  const handleChange = useCallback((v: string) => {
    setSource(v)
    setDirty(true)
  }, [])

  const handleOpenFile = useCallback(async (file: File) => {
    try {
      const content = await readFileAsText(file)
      setFileName(file.name)
      setFilePath(null)
      setSource(content)
      setDirty(false)
    } catch (err) {
      console.error(err)
      alert(`读取失败：${file.name}`)
    }
  }, [])

  // 顶栏"打开"按钮：Tauri 用原生对话框，浏览器用 <input>
  const handleToolbarOpen = useCallback(async () => {
    if (isTauri()) {
      const res = await tauriOpenFile()
      if (res) {
        setFileName(res.name)
        setFilePath(res.path)
        setSource(res.content)
        setDirty(false)
      }
    }
    // 浏览器环境由 Toolbar 的 <input> 处理
  }, [])

  const handleOpenRecent = useCallback((f: RecentFile) => {
    setFileName(f.name)
    setFilePath(null)
    setSource(f.content)
    setDirty(false)
  }, [])

  const handleSave = useCallback(async () => {
    const savedPath = await tauriSaveFile(source, filePath, fileName)
    if (isTauri() && savedPath) {
      setFilePath(savedPath)
      const savedName = savedPath.split(/[\\/]/).pop() ?? fileName
      setFileName(savedName)
      addRecent(savedName, source)
      setRecentKey((k) => k + 1)
    } else {
      // 浏览器 fallback
      saveTextAsFile(source, fileName)
      addRecent(fileName, source)
      setRecentKey((k) => k + 1)
    }
    setDirty(false)
  }, [source, filePath, fileName])

  const handleFontSize = useCallback((size: number) => {
    const clamped = Math.min(24, Math.max(11, size))
    setFontSize(clamped)
    localStorage.setItem(FONT_KEY, String(clamped))
  }, [])

  const handleJump = useCallback((line: number) => {
    editorRef.current?.scrollToLine(line)
  }, [])

  const { charCount, lineCount } = useMemo(() => {
    const chars = source.length
    const lines = source === '' ? 0 : source.split(/\r\n|\r|\n/).length
    return { charCount: chars, lineCount: lines }
  }, [source])

  return (
    <DropZone onFile={(name, content) => { setFileName(name); setFilePath(null); setSource(content); setDirty(false) }}>
      <div className="app">
        <Toolbar
          fileName={fileName}
          dirty={dirty}
          charCount={charCount}
          lineCount={lineCount}
          viewMode={viewMode}
          theme={theme}
          outlineOpen={outlineOpen}
          fontSize={fontSize}
          isTauri={isTauri()}
          onOpenFile={handleOpenFile}
          onToolbarOpen={handleToolbarOpen}
          onSave={handleSave}
          onViewModeChange={setViewMode}
          onThemeChange={setTheme}
          onToggleOutline={() => setOutlineOpen((v) => !v)}
          onFontSizeChange={handleFontSize}
        />
        <main className="content">
          {outlineOpen && viewMode !== 'preview' && (
            <Outline source={source} currentLine={currentLine} onJump={handleJump} />
          )}
          <div className="editor-area">
            {viewMode === 'preview' ? (
              <div className="preview-scroll">
                <div className="content-inner" style={{ fontSize: fontSize + 1 }}>
                  <MarkdownView source={source} />
                </div>
              </div>
            ) : (
              <LiveEditor
                ref={editorRef}
                value={source}
                onChange={handleChange}
                onSave={handleSave}
                viewMode={viewMode}
                fontSize={fontSize}
                onCursorLine={setCurrentLine}
              />
            )}
          </div>
          <RecentMenu onOpen={handleOpenRecent} refreshKey={recentKey} />
        </main>
      </div>
    </DropZone>
  )
}
