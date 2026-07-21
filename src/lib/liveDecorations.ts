import {
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view'
import { Decoration, type EditorView } from '@codemirror/view'
import { type Range, type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNodeRef, TreeCursor } from '@lezer/common'
import { findBlocks } from './blockDecorations'

/**
 * 实时渲染装饰层（Obsidian 风，v2.0 基于 CodeMirror markdown 语法树）。
 *
 * v2.0 改造：从手写正则 → syntaxTree.iterate 遍历语法节点。
 * 优势：
 * - 行内代码内的 `$x$` / `*foo*` 不再被误装饰（语法树天然区分 CodeText）
 * - 标题内的强调/链接能正确渲染（之前 buildLineDecorations 命中标题就 return）
 * - 嵌套节点（如 ***粗斜体***）装饰自动叠加
 * - 转义符 `\*` 不会被误识别（语法树包成 Escape 节点）
 * - 与预览模式（markdown-it）行为天然一致（两者都基于 CommonMark 语法）
 *
 * 核心原则不变：
 * - 原始 Markdown 是唯一数据源，所有装饰都是 view-only。
 * - 光标所在行不加装饰（保持源码形态），移走后自动渲染。
 * - 块级区域（代码/表格/公式）的内联装饰跳过，避免与 block widget 冲突。
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
    img.loading = 'lazy'
    // 本地 .md 可能用相对路径或 file:// —— 浏览器默认同源策略会拒绝，
    // 这里放开，保证本地图片也能渲染。
    img.referrerPolicy = 'no-referrer'
    img.className = 'md-img'
    // 图片加载失败时，用一个可见占位框替换破损图标。
    // 直接改 <img> 的 class 在不同浏览器里表现不一致（有的会 0 高度空白），
    // 所以换成外层 wrapper 包 img，error 时把 img 隐藏、显示 wrapper 里的
    // 占位文本。这样无论浏览器怎么渲染破损 img，都有稳定的可见反馈。
    const wrapper = document.createElement('span')
    wrapper.className = 'md-img-wrap'
    const placeholder = document.createElement('span')
    placeholder.className = 'md-img-broken'
    placeholder.textContent = this.alt || this.src
    placeholder.style.display = 'none'
    wrapper.appendChild(img)
    wrapper.appendChild(placeholder)
    img.addEventListener('error', () => {
      img.style.display = 'none'
      placeholder.style.display = ''
    })
    return wrapper
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

// --- 引用式链接表 ------------------------------------------------------
// 扫描全文构建 `[label]: url` 映射，供 ![alt][label] / [text][label] 解析。
// label 按 CommonMark 规范做大小写不敏感比较。
function buildReferenceMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /^[ ]{0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?[ \t]*(?:[ \t].*)?$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const label = m[1].trim().toLowerCase()
    const url = m[2]
    // 首次出现的定义优先（CommonMark 规范）
    if (!map.has(label)) map.set(label, url)
  }
  return map
}

// --- 语法树遍历辅助 ----------------------------------------------------

/** 遍历节点的直接子节点，对匹配 childName 的子节点执行 fn。 */
function forEachChild(
  node: { cursor: () => TreeCursor },
  childName: string | string[],
  fn: (from: number, to: number) => void,
): void {
  const names = Array.isArray(childName) ? childName : [childName]
  const cur = node.cursor()
  if (cur.firstChild()) {
    do {
      if (names.includes(cur.name)) fn(cur.from, cur.to)
    } while (cur.nextSibling())
  }
}

/** 拿节点的第一个指定类型子节点的范围。 */
function getChildRange(
  node: { cursor: () => TreeCursor },
  childName: string,
): { from: number; to: number } | null {
  const cur = node.cursor()
  if (cur.firstChild()) {
    do {
      if (cur.name === childName) return { from: cur.from, to: cur.to }
    } while (cur.nextSibling())
  }
  return null
}

// --- 装饰构建（核心）---------------------------------------------------
function buildDecorations(view: EditorView): DecorationSet {
  const cursorLines = getCursorLines(view)
  const decos: Range<Decoration>[] = []
  const add = (d: Range<Decoration>) => decos.push(d)
  const state = view.state

  // 块级区域：代码/表格/公式，用 blockDecorations 的结果。
  // 这些区域内的内联装饰跳过（避免和 block widget 冲突）。
  const blocks = findBlocks(state)
  const blockRangeHit = (from: number, to: number) =>
    blocks.some((b) => from <= b.to && to >= b.from)

  // 引用式链接表（全文档扫描）
  const refs = buildReferenceMap(state.doc.toString())

  // 已被语法树识别为 Image/Link 的区间，fallback 扫描时跳过（避免双重装饰）
  const imgRanges: Array<[number, number]> = []

  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref
      const nodeFrom = node.from
      const nodeTo = node.to

      // 块内跳过（代码/表格/公式由 blockField 渲染）
      if (blockRangeHit(nodeFrom, nodeTo)) {
        // 但代码块/表格本身不遍历内部
        if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'Table') {
          return false
        }
      }

      // 节点起始行是否被光标覆盖（整行豁免）
      const nodeLine = state.doc.lineAt(nodeFrom).number
      const inCursorLine = cursorLines.has(nodeLine)

      // --- 标题（ATX + Setext） ---
      // 节点名 ATXHeading1~6 / SetextHeading1~2。
      // 注意：不能用 node.type.is('Heading')——默认 parser 没注册 Heading group，
      // 实测返回 false。直接用节点名字符串匹配最可靠。
      if (
        node.name.startsWith('ATXHeading') ||
        node.name === 'SetextHeading1' ||
        node.name === 'SetextHeading2'
      ) {
        if (!inCursorLine) {
          const level = headingLevel(node.name)
          const lineStart = state.doc.lineAt(nodeFrom).from
          add(Decoration.line({ class: `md-h md-h${level}` }).range(lineStart))
          // HeaderMark（# 号或 === / ---）隐藏
          forEachChild(node.node, 'HeaderMark', (from, to) => {
            add(Decoration.mark({ class: 'md-format' }).range(from, to))
          })
        }
        // 不 return false：标题内的强调/链接继续遍历（这是 v1 的 bug：之前 return 跳过了）
        return
      }

      // --- 引用块 / 列表的 mark（行级样式 + mark 隐藏） ---
      if (node.name === 'QuoteMark' || node.name === 'ListMark') {
        if (!inCursorLine) {
          // 给整行加引用/列表样式
          const lineStart = state.doc.lineAt(nodeFrom).from
          const cls = node.name === 'QuoteMark' ? 'md-quote' : 'md-list'
          add(Decoration.line({ class: cls }).range(lineStart))
          add(Decoration.mark({ class: 'md-format' }).range(nodeFrom, nodeTo))
        }
        return
      }

      // --- 任务标记 [ ] / [x] ---
      if (node.name === 'TaskMarker') {
        if (!inCursorLine) {
          const raw = state.doc.sliceString(nodeFrom, nodeTo)
          const checked = /x/i.test(raw)
          add(
            Decoration.replace({ widget: new TaskCheckboxWidget(checked), block: false }).range(
              nodeFrom,
              nodeTo,
            ),
          )
        }
        return
      }

      // --- 分隔线 ---
      if (node.name === 'HorizontalRule') {
        if (!inCursorLine) {
          add(Decoration.replace({ widget: new HrWidget(), block: false }).range(nodeFrom, nodeTo))
        }
        return false
      }

      // --- 以下都是内联装饰，光标行跳过 ---
      if (inCursorLine) return

      // --- 强调（斜体/粗体） ---
      // StrongEmphasis = **粗体**，Emphasis = *斜体*。
      // ***粗斜体*** 在语法树里是嵌套的 Emphasis+StrongEmphasis，
      // 各自加 md-italic / md-bold，CSS class 叠加自动得到 md-bold md-italic。
      if (node.name === 'Emphasis' || node.name === 'StrongEmphasis') {
        const cls = node.name === 'StrongEmphasis' ? 'md-bold' : 'md-italic'
        // 给整个节点范围加样式（不含 mark）
        // 但要先标 mark 隐藏，再给非 mark 部分加样式。
        // 简化处理：给整个节点加 cls，mark 子节点额外加 md-format（display:none 优先级高）
        add(Decoration.mark({ class: cls }).range(nodeFrom, nodeTo))
        forEachChild(node.node, 'EmphasisMark', (from, to) => {
          add(Decoration.mark({ class: 'md-format' }).range(from, to))
        })
        return // 不 return false，让嵌套节点继续遍历
      }

      // --- 行内代码 ---
      // 节点结构：[CodeMark] 代码内容 [CodeMark]（注意：没有独立的 CodeText 子节点，
      // 代码内容是两个 CodeMark 之间的文本）
      if (node.name === 'InlineCode') {
        const marks: Array<[number, number]> = []
        forEachChild(node.node, 'CodeMark', (from, to) => marks.push([from, to]))
        if (marks.length >= 2) {
          // 反引号隐藏，中间代码内容加 md-code 样式
          add(Decoration.mark({ class: 'md-format' }).range(marks[0][0], marks[0][1]))
          add(Decoration.mark({ class: 'md-code' }).range(marks[0][1], marks[marks.length - 1][0]))
          add(Decoration.mark({ class: 'md-format' }).range(marks[marks.length - 1][0], marks[marks.length - 1][1]))
        } else {
          // 退化：没有 CodeMark（理论上不会），整体当代码
          add(Decoration.mark({ class: 'md-code' }).range(nodeFrom, nodeTo))
        }
        return false
      }

      // --- 删除线 ---
      if (node.name === 'Strikethrough') {
        // 找内部非 mark 的范围加 md-strike
        const marks: Array<[number, number]> = []
        forEachChild(node.node, 'StrikethroughMark', (from, to) => marks.push([from, to]))
        if (marks.length === 2) {
          add(Decoration.mark({ class: 'md-format' }).range(marks[0][0], marks[0][1]))
          add(Decoration.mark({ class: 'md-strike' }).range(marks[0][1], marks[1][0]))
          add(Decoration.mark({ class: 'md-format' }).range(marks[1][0], marks[1][1]))
        } else {
          add(Decoration.mark({ class: 'md-strike' }).range(nodeFrom, nodeTo))
        }
        return false
      }

      // --- 行内公式 $...$ ---
      // lang-markdown 默认不解析数学，这里保留手写识别（避免和代码/强调冲突）
      // 注意：语法树里 $x$ 会被当成普通文本，我们需要主动扫描。
      // 但只在"未被其他节点覆盖"的文本上扫描——交给后面的 fallback。

      // --- 链接 ---
      if (node.name === 'Link') {
        decorateLink(node, add)
        return false
      }

      // --- 图片 ---
      if (node.name === 'Image') {
        imgRanges.push([nodeFrom, nodeTo])
        decorateImage(node, state, refs, add)
        return false
      }
    },
  })

  // --- fallback：行内公式 $...$ 和 HTML <img>（语法树不直接识别）---
  // 只在非光标行、非块内的普通段落文本上扫描。
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      const isCursorLine = cursorLines.has(line.number)
      const inBlock = blockRangeHit(line.from, line.to)
      if (!isCursorLine && !inBlock) {
        buildFallbackDecorations(line, add, imgRanges)
      }
      pos = line.to + 1
    }
  }

  return Decoration.set(decos, true)
}

/** 从节点名拿标题级别。 */
function headingLevel(name: string): number {
  if (name.startsWith('ATXHeading')) {
    const n = Number(name.slice('ATXHeading'.length))
    return Math.max(1, Math.min(6, n || 1))
  }
  if (name === 'SetextHeading1') return 1
  if (name === 'SetextHeading2') return 2
  return 1
}

/** 装饰链接节点：URL 和 LinkMark 隐藏，label 文本标 md-link-text。 */
function decorateLink(
  node: SyntaxNodeRef,
  add: (d: Range<Decoration>) => void,
): void {
  // 收集 LinkMark 子节点（[ ] ( ) 四个）
  const marks: Array<[number, number]> = []
  const cur = node.node.cursor()
  if (cur.firstChild()) {
    do {
      if (cur.name === 'LinkMark') marks.push([cur.from, cur.to])
    } while (cur.nextSibling())
  }

  if (marks.length < 2) return
  const firstMark = marks[0]
  const textStart = firstMark[1]
  const textEnd = marks[1][0]  // 第二个 mark（]）的起点 = 文本结束

  // 第一个 [ 隐藏
  add(Decoration.mark({ class: 'md-format' }).range(firstMark[0], firstMark[1]))
  // 文本标链接文字
  if (textEnd > textStart) {
    add(Decoration.mark({ class: 'md-link-text' }).range(textStart, textEnd))
  }
  // 从 ] 到节点结束全部隐藏（含 URL、括号、title）
  add(Decoration.mark({ class: 'md-format' }).range(textEnd, node.to))
}

/** 装饰图片节点：整体 replace 成 ImageWidget。 */
function decorateImage(
  node: SyntaxNodeRef,
  state: EditorState,
  refs: Map<string, string>,
  add: (d: Range<Decoration>) => void,
): void {
  // 拿 URL 子节点
  const urlRange = getChildRange(node.node, 'URL')
  // 拿 alt 文本（图片的 alt 是 `[...]` 里的内容，即第一个 LinkMark 之后到第二个 LinkMark 之前）
  let alt = ''
  const marks: Array<[number, number]> = []
  forEachChild(node.node, 'LinkMark', (from, to) => marks.push([from, to]))
  if (marks.length >= 2) {
    alt = state.doc.sliceString(marks[0][1], marks[1][0]).trim()
  }

  let src = ''
  if (urlRange) {
    src = state.doc.sliceString(urlRange.from, urlRange.to)
    // 角括号包裹的 URL 去掉 <>
    src = src.replace(/^<|>$/g, '')
  } else {
    // 引用式图片 ![alt][label]：从 LinkLabel 查 refs
    const labelRange = getChildRange(node.node, 'LinkLabel')
    if (labelRange) {
      const label = state.doc.sliceString(labelRange.from, labelRange.to).trim().toLowerCase()
      // 去掉可能的 [ ] 包裹（LinkLabel 通常不含括号，但保险）
      src = refs.get(label.replace(/^\[|\]$/g, '')) ?? ''
    } else if (marks.length >= 2) {
      // 折叠式 ![label]：alt 本身作 label
      const label = alt.toLowerCase()
      src = refs.get(label) ?? ''
    }
  }

  if (src) {
    add(
      Decoration.replace({ widget: new ImageWidget(src, alt), block: false }).range(
        node.from,
        node.to,
      ),
    )
  }
}

/**
 * Fallback 装饰：处理语法树不直接识别的内容。
 * - Markdown 图片 ![alt](url) —— 语法树对 URL 合法性要求严格（空格/尖括号都不行），
 *   data URI（特别是 SVG 内嵌的）常常带空格，语法树会漏。这里用括号配对补齐。
 * - 行内公式 $...$（lang-markdown 默认不解析数学）
 * - HTML <img> 标签
 * - 引用定义行 [label]: url
 */
function buildFallbackDecorations(
  line: { number: number; from: number; to: number; text: string },
  add: (d: Range<Decoration>) => void,
  imgRanges: Array<[number, number]>,
): void {
  const { from, text } = line
  let m: RegExpExecArray | null

  // 引用定义行 [label]: url —— 弱化样式
  if (/^[ ]{0,3}\[[^\]]+\]:[ \t]*<?[^\s>]+>?/.test(text)) {
    add(Decoration.line({ class: 'md-link-ref' }).range(from))
    return
  }

  // Markdown 图片 ![alt](url) —— 用括号配对，宽容 data URI 的空格/尖括号。
  // 跳过已被语法树 Image 节点覆盖的区间（避免双重 replace 装饰冲突）。
  const imgStartRe = /!\[([^\]]*)\]/g
  while ((m = imgStartRe.exec(text))) {
    const start = from + m.index
    const labelEnd = m.index + m[0].length
    // 跳过已被语法树识别的图片区间
    if (imgRanges.some(([s, e]) => start >= s && start < e)) {
      imgStartRe.lastIndex = labelEnd
      continue
    }
    if (text[labelEnd] !== '(') continue
    const close = findCloseParen(text, labelEnd)
    if (close === -1) {
      imgStartRe.lastIndex = labelEnd + 1
      continue
    }
    const inner = text.slice(labelEnd + 1, close)
    const src = extractUrlFromInner(inner)
    if (!src) {
      imgStartRe.lastIndex = close + 1
      continue
    }
    const end = from + close + 1
    add(Decoration.replace({ widget: new ImageWidget(src, m[1]), block: false }).range(start, end))
    imgStartRe.lastIndex = close + 1
  }

  // HTML <img src="..."> 标签
  const htmlImgRe = /<img\b[^>]*>/gi
  while ((m = htmlImgRe.exec(text))) {
    const srcMatch = m[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (!srcMatch) continue
    const src = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? ''
    const altMatch = m[0].match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const alt = altMatch?.[1] ?? altMatch?.[2] ?? altMatch?.[3] ?? ''
    const start = from + m.index
    const end = start + m[0].length
    add(Decoration.replace({ widget: new ImageWidget(src, alt), block: false }).range(start, end))
  }

  // 行内公式 $...$（避免匹配 $$ 和表格 |）
  const inlineMathRe = /(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g
  while ((m = inlineMathRe.exec(text))) {
    const start = from + m.index
    add(Decoration.mark({ class: 'md-format' }).range(start, start + 1))
    add(Decoration.mark({ class: 'md-math-inline' }).range(start + 1, start + 1 + m[1].length))
    add(Decoration.mark({ class: 'md-format' }).range(start + 1 + m[1].length, start + m[0].length))
  }
}

// --- 工具：括号配对（用于 fallback 图片 URL 解析）---------------------
// 找 ( 对应的 )，跳过 <> 包裹的区间（角括号 URL 可含空格）。
function findCloseParen(s: string, open: number): number {
  let depth = 0
  let inAngle = false
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (inAngle) {
      if (c === '>') inAngle = false
      continue
    }
    if (c === '<') {
      inAngle = true
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// 从 (url "title") 片段抽 src。data:/mailto: 整体返回（不按空格截断）。
function extractUrlFromInner(inner: string): string {
  const s = inner.trim()
  if (!s) return ''
  const angle = s.match(/^<([^]*)>$/)
  if (angle) return angle[1].trim()
  if (/^data:/i.test(s)) return s
  if (/^mailto:/i.test(s)) return s
  return s.split(/\s+/)[0]
}

// --- ViewPlugin --------------------------------------------------------
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate) {
      // docChanged/viewportChanged 覆盖文档变化和解析推进（解析推进会改 viewport）。
      // selectionSet 用于光标行豁免更新。语法树后台解析完成时通常也会触发 viewportChanged。
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)
