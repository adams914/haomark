import {
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view'
import { Decoration, type EditorView } from '@codemirror/view'
import { type Range } from '@codemirror/state'
import { findBlocks } from './blockDecorations'

/**
 * 实时渲染装饰层（Obsidian 风，逐行方案）。
 *
 * 核心原则：
 * - 原始 Markdown 是唯一数据源，所有装饰都是 view-only，不修改文档。
 * - 光标所在的行不加任何渲染装饰（保持源码形态），移走后自动渲染。
 * - 块级元素（代码/表格/公式/Mermaid）用「逐行样式」，不用 block widget
 *   （CM6 的 block widget 光标无法点击进入，是硬限制）。这样点击任意行
 *   都能原生进入编辑，和标题/强调的体验完全一致。
 * - 代码块内部的语法高亮交给 CodeMirror 的 lang-markdown（已支持）。
 */

// --- 工具：判断某行是否被光标覆盖 -------------------------------------
function getCursorLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(r.from).number
    const endLine = view.state.doc.lineAt(r.to).number
    for (let n = startLine; n <= endLine; n++) lines.add(n)
  }
  return lines
}

// --- Widgets -----------------------------------------------------------
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM() {
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.className = 'md-img'
    return img
  }
  ignoreEvent() {
    return false
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked
  }
  toDOM() {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'md-task'
    cb.checked = this.checked
    cb.disabled = true
    return cb
  }
  ignoreEvent() {
    return false
  }
}

class HrWidget extends WidgetType {
  toDOM() {
    const div = document.createElement('div')
    div.className = 'md-hr-line'
    return div
  }
  ignoreEvent() {
    return true
  }
}

// --- 行内块状态跟踪 ----------------------------------------------------
// 扫描文档确定每一行的「块上下文」。块类型用位标记，便于叠加判断。
// --- 单行装饰构建 ----------------------------------------------------
function buildLineDecorations(
  line: { number: number; from: number; to: number; text: string },
  add: (deco: Range<Decoration>) => void,
) {
  const { from, to, text } = line
  const raw = text

  // --- 标题 # ~ ######
  const heading = raw.match(/^(#{1,6})\s+(.*)$/)
  if (heading) {
    const level = heading[1].length
    add(Decoration.line({ class: `md-h md-h${level}` }).range(from))
    const markLen = heading[1].length + 1
    add(Decoration.mark({ class: 'md-format' }).range(from, from + markLen))
    return
  }

  // --- 引用 >
  if (/^>\s?/.test(raw)) {
    add(Decoration.line({ class: 'md-quote' }).range(from))
    const m = raw.match(/^(>\s?)/)
    if (m) add(Decoration.mark({ class: 'md-format' }).range(from, from + m[1].length))
  }

  // --- 无序列表 - / * / +
  const ul = raw.match(/^(\s*)([-*+])\s+/)
  if (ul) {
    add(Decoration.line({ class: 'md-list' }).range(from))
    const markStart = from + ul[1].length
    const markEnd = markStart + ul[2].length + 1
    const task = raw.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+/)
    if (task) {
      const taskMarkEnd = from + task[1].length + task[2].length + 1
      add(Decoration.mark({ class: 'md-format' }).range(markStart, taskMarkEnd))
      const boxFrom = taskMarkEnd
      const boxTo = boxFrom + 3
      const checked = task[3].toLowerCase() === 'x'
      add(Decoration.replace({ widget: new TaskCheckboxWidget(checked), block: false }).range(boxFrom, boxTo))
      add(Decoration.mark({ class: 'md-format' }).range(boxTo, boxTo + 1))
      return
    }
    add(Decoration.mark({ class: 'md-format' }).range(markStart, markEnd))
    return
  }

  // --- 有序列表 1.
  const ol = raw.match(/^(\s*)(\d+\.)\s+/)
  if (ol) {
    add(Decoration.line({ class: 'md-olist' }).range(from))
    const markStart = from + ol[1].length
    const markEnd = markStart + ol[2].length + 1
    add(Decoration.mark({ class: 'md-format' }).range(markStart, markEnd))
    return
  }

  // --- 分隔线
  if (/^(\s*)([-*_])\2{2,}\s*$/.test(raw) && raw.trim().length >= 3) {
    add(Decoration.line({ class: 'md-hr' }).range(from))
    add(Decoration.replace({ widget: new HrWidget(), block: false }).range(from, to))
    return
  }
}

// --- 内联装饰（标题/强调/链接/图片/行内代码/行内公式）------------------
function buildInlineDecorations(
  line: { number: number; from: number; to: number; text: string },
  add: (deco: Range<Decoration>) => void,
) {
  const { from, text } = line
  let m: RegExpExecArray | null

  // 图片 ![alt](src)
  const imgRe = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g
  while ((m = imgRe.exec(text))) {
    const start = from + m.index
    const end = start + m[0].length
    add(Decoration.replace({ widget: new ImageWidget(m[2], m[1]), block: false }).range(start, end))
  }

  // 链接 [text](url)
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g
  while ((m = linkRe.exec(text))) {
    const start = from + m.index
    const textStart = start + 1
    const textEnd = textStart + m[1].length
    add(Decoration.mark({ class: 'md-format' }).range(start, textStart))
    add(Decoration.mark({ class: 'md-link-text' }).range(textStart, textEnd))
    add(Decoration.mark({ class: 'md-format' }).range(textEnd, start + m[0].length))
  }

  // 行内公式 $...$（避免匹配 $$ 和表格 |）
  const inlineMathRe = /(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g
  while ((m = inlineMathRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 1))
    add(Decoration.mark({ class: 'md-math-inline' }).range(start + 1, start + 1 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 1 + m[1].length, start + m[0].length))
  }

  // 粗斜体
  const boldItalicRe = /(\*{3}|_{3})(.+?)\1/g
  while ((m = boldItalicRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + m[1].length))
    add(Decoration.mark({ class: 'md-bold md-italic' }).range(start + m[1].length, start + m[1].length + m[2].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + m[1].length + m[2].length, start + m[0].length))
  }

  // 粗体
  const boldRe = /(?<!\*)\*{2}(?!\*)(.+?)(?<!\*)\*{2}(?!\*)/g
  while ((m = boldRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 2))
    add(Decoration.mark({ class: 'md-bold' }).range(start + 2, start + 2 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 2 + m[1].length, start + m[0].length))
  }

  // 斜体
  const italicRe = /(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g
  while ((m = italicRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 1))
    add(Decoration.mark({ class: 'md-italic' }).range(start + 1, start + 1 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 1 + m[1].length, start + m[0].length))
  }

  // 删除线
  const delRe = /~~(?!\s)(.+?)(?<!\s)~~/g
  while ((m = delRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 2))
    add(Decoration.mark({ class: 'md-strike' }).range(start + 2, start + 2 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 2 + m[1].length, start + m[0].length))
  }

  // 行内代码
  const codeRe = /`([^`]+)`/g
  while ((m = codeRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 1))
    add(Decoration.mark({ class: 'md-code' }).range(start + 1, start + 1 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 1 + m[1].length, start + m[0].length))
  }
}

// --- ViewPlugin：遍历可视行，构建装饰 ---------------------------------
function buildDecorations(view: EditorView): DecorationSet {
  const cursorLines = getCursorLines(view)
  const decos: Range<Decoration>[] = []
  const add = (d: Range<Decoration>) => decos.push(d)

  // 块级区域交给 blockDecorations 的 StateField 渲染（widget）；
  // 内联装饰跳过这些行，避免与 block replace 冲突（CM6 禁止 line 装饰
  // 与 block replace 同行，会出空行 bug）。
  const blocks = findBlocks(view.state)
  const lineInBlock = (lineFrom: number, lineTo: number) =>
    blocks.some((b) => lineFrom <= b.to && lineTo >= b.from)

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      const isCursorLine = cursorLines.has(line.number)
      const inBlock = lineInBlock(line.from, line.to)

      if (!isCursorLine && !inBlock) {
        buildLineDecorations(line, add)
        buildInlineDecorations(line, add)
      }
      pos = line.to + 1
    }
  }

  return Decoration.set(decos, true)
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)
