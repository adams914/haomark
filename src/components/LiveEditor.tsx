import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, highlightActiveLine, lineNumbers, ViewPlugin } from '@codemirror/view'
import { Prec, EditorSelection, type Extension } from '@codemirror/state'
import { livePreviewPlugin } from '../lib/liveDecorations'
import { blockField, blockAtomicRanges } from '../lib/blockDecorations'
import type { ViewMode } from '../lib/tabs'

// re-export 保持下游 import { ViewMode } from './LiveEditor' 兼容
export type { ViewMode }

export interface LiveEditorHandle {
  /** 跳转到指定行（1 基）并滚动入视图 */
  scrollToLine: (line: number) => void
  /**
   * 强制 CodeMirror 重新测量 DOM。
   * 用于 tab 从 display:none 切回 visible 时——CM6 在隐藏态下无法测量尺寸，
   * 切回后需要主动触发，否则行高/换行会错乱。
   */
  refresh: () => void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  onSaveAll?: () => void
  viewMode: ViewMode
  /** 编辑器字号 */
  fontSize?: number
  /** 拼写检查（v2.0 设置）*/
  spellcheck?: boolean
  /** 源码模式行号（v2.0 设置）*/
  showLineNumbers?: boolean
  /** 软换行（v2.0 设置）*/
  lineWrapping?: boolean
  /** 光标所在行变化时回调（1 基），供大纲高亮 */
  onCursorLine?: (line: number) => void
}

/**
 * 包裹/反转选区的内联标记（** * ` ~~）。无选区时插入空标记并把光标放中间。
 */
function wrapSelection(view: EditorView, before: string, after: string = before): boolean {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const selected = state.doc.sliceString(range.from, range.to)
    if (selected.length === 0) {
      const insert = before + after
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + before.length, range.from + before.length),
      }
    }
    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
      const inner = selected.slice(before.length, selected.length - after.length)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }
    return {
      changes: { from: range.from, to: range.to, insert: before + selected + after },
      range: EditorSelection.range(range.from, range.from + before.length + selected.length),
    }
  })
  view.dispatch(changes, { scrollIntoView: true })
  view.focus()
  return true
}

const LiveEditor = forwardRef<LiveEditorHandle, Props>(function LiveEditor(
  { value, onChange, onSave, onSaveAll, viewMode, fontSize = 15, spellcheck = false, showLineNumbers = true, lineWrapping = true, onCursorLine },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null)

  // 暴露跳转 + refresh 方法给父组件
  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const view = viewRef.current
      if (!view) return
      const lineObj = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
      view.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      })
      view.focus()
    },
    refresh() {
      const view = viewRef.current
      if (!view) return
      // 空事务触发重新测量；requestMeasure 保证 CM6 重排
      view.requestMeasure()
    },
  }))

  // 快捷键：Ctrl+S 保存、Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+` 行内代码、Ctrl+/ 切换注释（标题）
  const keymap = useMemo(
    () =>
      Prec.highest(
        EditorView.domEventHandlers({
          keydown(e: KeyboardEvent) {
            const mod = e.ctrlKey || e.metaKey
            if (!mod) return false
            const view = viewRef.current
            if (!view) return false
            const key = e.key.toLowerCase()
            if (key === 's') {
              e.preventDefault()
              // Ctrl+Alt+S = 保存全部，Ctrl+S = 保存当前
              if (e.altKey) {
                onSaveAll?.()
              } else {
                onSave?.()
              }
              return true
            }
            if (viewMode === 'preview') return false
            if (key === 'b') {
              e.preventDefault()
              return wrapSelection(view, '**')
            }
            if (key === 'i') {
              e.preventDefault()
              return wrapSelection(view, '*')
            }
            if (key === 'e') {
              e.preventDefault()
              return wrapSelection(view, '`')
            }
            return false
          },
        }),
      ),
    [onSave, onSaveAll, viewMode],
  )

  // 光标行变化 → 通知父组件（大纲高亮）
  const cursorTrackPlugin = useMemo(
    () =>
      ViewPlugin.fromClass(
        class {
          update(u: import('@codemirror/view').ViewUpdate) {
            if (u.selectionSet || u.docChanged) {
              const line = u.view.state.doc.lineAt(u.view.state.selection.main.head).number
              onCursorLine?.(line)
            }
          }
        },
      ),
    [onCursorLine],
  )

  const extensions = useMemo<Extension[]>(() => {
    const base: Extension[] = [
      // 软换行：可由设置开关
      ...(lineWrapping ? [EditorView.lineWrapping] : []),
      keymap,
      cursorTrackPlugin,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
    ]
    if (viewMode === 'live') {
      return [highlightActiveLine(), ...base, livePreviewPlugin, blockField, blockAtomicRanges]
    }
    // 源码模式：行号可由设置开关
    return [
      ...(showLineNumbers ? [lineNumbers()] : []),
      highlightActiveLine(),
      ...base,
    ]
  }, [viewMode, keymap, cursorTrackPlugin, showLineNumbers, lineWrapping])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      className="cm-editor-wrap"
      height="100%"
      style={{ height: '100%', fontSize }}
      // 拼写检查：直接透传到 CodeMirror 的 content DOM
      spellCheck={spellcheck}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      basicSetup={{
        lineNumbers: viewMode === 'source' && showLineNumbers,
        highlightActiveLine: true,
        highlightActiveLineGutter: viewMode === 'source' && showLineNumbers,
        foldGutter: false,
        autocompletion: false,
        searchKeymap: true,
      }}
    />
  )
})

export default LiveEditor
