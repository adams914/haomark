import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, highlightActiveLine, lineNumbers, ViewPlugin } from '@codemirror/view'
import { Prec, EditorSelection, type Extension } from '@codemirror/state'
import { livePreviewPlugin } from '../lib/liveDecorations'
import { blockField, blockAtomicRanges } from '../lib/blockDecorations'

export type ViewMode = 'live' | 'source' | 'preview'

export interface LiveEditorHandle {
  /** 跳转到指定行（1 基）并滚动入视图 */
  scrollToLine: (line: number) => void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  viewMode: ViewMode
  /** 编辑器字号 */
  fontSize?: number
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
  { value, onChange, onSave, viewMode, fontSize = 15, onCursorLine },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null)

  // 暴露跳转方法给父组件
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
              onSave?.()
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
    [onSave, viewMode],
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
      EditorView.lineWrapping,
      keymap,
      cursorTrackPlugin,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
    ]
    if (viewMode === 'live') {
      return [highlightActiveLine(), ...base, livePreviewPlugin, blockField, blockAtomicRanges]
    }
    return [lineNumbers(), highlightActiveLine(), ...base]
  }, [viewMode, keymap, cursorTrackPlugin])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      className="cm-editor-wrap"
      height="100%"
      style={{ height: '100%', fontSize }}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      basicSetup={{
        lineNumbers: viewMode === 'source',
        highlightActiveLine: true,
        highlightActiveLineGutter: viewMode === 'source',
        foldGutter: false,
        autocompletion: false,
        searchKeymap: true,
      }}
    />
  )
})

export default LiveEditor
