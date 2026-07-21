import { StateField, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import hljs from 'highlight.js'
import katex from 'katex'
import mermaid from 'mermaid'
import { md } from './renderer'

/**
 * 块级实时渲染（Obsidian 风：点击块进入编辑）。
 *
 * 核心闭环：
 * - 光标在块外 → 块被 widget 渲染（高亮/表格/KaTeX/Mermaid）
 * - 点击 widget → widget 主动 view.dispatch 光标到块起始 → 触发 selectionSet
 * - StateField 检测光标进入块 → 撤掉该块 replace 装饰 → 源码显现 → 可编辑
 * - 光标移出 → 重新加 replace 装饰 → 块变回渲染态
 *
 * 约束：跨行/block 级 widget 必须用 StateField（CM6 禁止 ViewPlugin 提供）。
 */

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })

// --- 块识别 -------------------------------------------------------------
export interface BlockRange {
  from: number
  to: number
  type: 'code' | 'mermaid' | 'table' | 'math'
  content: string
  lang?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 扫描整个文档，找出所有块级区域。
 *
 * v2.0 改造：代码块/表格从 CodeMirror markdown 语法树派生
 * （比手写正则更准——正确处理缩进代码块、info string 空格、表格列数等）。
 * 数学公式块仍用手写正则（lang-markdown 默认不解析 $$）。
 */
export function findBlocks(state: EditorState): BlockRange[] {
  const blocks: BlockRange[] = []
  const doc = state.doc

  // 1. 从语法树拿 FencedCode + Table
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        // CodeInfo 子节点 = 语言标识（info string 第一个 token）
        const langNode = node.node.getChild('CodeInfo')
        const lang = langNode ? doc.sliceString(langNode.from, langNode.to).trim() : ''
        blocks.push({
          from: node.from,
          to: node.to,
          type: lang.toLowerCase() === 'mermaid' ? 'mermaid' : 'code',
          content: doc.sliceString(node.from, node.to),
          lang,
        })
        return false // 不遍历代码块内部
      }
      if (node.name === 'Table') {
        blocks.push({
          from: node.from,
          to: node.to,
          type: 'table',
          content: doc.sliceString(node.from, node.to),
        })
        return false
      }
      return
    },
  })

  // 2. 数学公式块 $$ ... $$（lang-markdown 不解析，手写正则）
  pushMathBlocks(state, blocks)

  return blocks
}

/** 扫描 $$...$$ 公式块，追加到 blocks。 */
function pushMathBlocks(state: EditorState, blocks: BlockRange[]): void {
  const doc = state.doc
  const lineCount = doc.lines
  let i = 1
  while (i <= lineCount) {
    const line = doc.line(i)
    const text = line.text
    if (/^\s*\$\$/.test(text)) {
      // 单行 $$...$$（同一行内有开始和结束）
      const single = text.match(/^\s*\$\$(.+)\$\$\s*$/)
      if (single) {
        blocks.push({ from: line.from, to: line.to, type: 'math', content: single[1] })
        i++
        continue
      }
      // 多行 $$ ... $$（结束 $$ 在后续行）
      let end = i + 1
      while (end <= lineCount && !doc.line(end).text.includes('$$')) end++
      const endLine = doc.line(Math.min(end, lineCount))
      const inner = doc.sliceString(line.to + 1, endLine.from)
      blocks.push({ from: line.from, to: endLine.to, type: 'math', content: inner })
      i = end + 1
      continue
    }
    i++
  }
}

function isCursorInBlock(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

// --- Widgets：每个都持有源码范围，点击时 dispatch 光标进块 -------------
abstract class EditableBlockWidget extends WidgetType {
  constructor(readonly blockFrom: number, readonly blockTo: number) {
    super()
  }
  /** 子类渲染内容到 wrap；基类统一接管点击 */
  protected abstract renderContent(): HTMLElement
  protected baseClass = 'md-block'
  /** 子类内容相等性（不含位置）。基类 eq() 在此基础上加位置比较。 */
  protected abstract contentEq(other: this): boolean

  eq(other: object): boolean {
    if (!(other instanceof EditableBlockWidget)) return false
    // 位置必须相同——否则内容相同的不同块会复用 widget，
    // 导致点击定位错乱（mousedown 监听器闭包持旧 blockFrom）。
    return (
      other.blockFrom === this.blockFrom &&
      other.blockTo === this.blockTo &&
      this.contentEq(other as this)
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = this.baseClass
    wrap.appendChild(this.renderContent())
    // 关键：点击 → dispatch 光标到块首下一字符（落在块范围内）
    wrap.addEventListener('mousedown', (e) => {
      // 只拦截主键（左键），允许右键菜单和中键。
      // 同时允许用户在 widget 内部选中文本（如代码块）。
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      view.focus()
      view.dispatch({
        selection: { anchor: this.blockFrom + 1 },
        scrollIntoView: false,
      })
    })
    return wrap
  }
  ignoreEvent() {
    return false // 让 mousedown 被我们的监听器处理
  }
}

class CodeBlockWidget extends EditableBlockWidget {
  constructor(readonly code: string, readonly lang: string, from: number, to: number) {
    super(from, to)
    this.baseClass = 'md-block md-code-block'
  }
  protected contentEq(o: this): boolean {
    return o.code === this.code && o.lang === this.lang
  }
  protected renderContent(): HTMLElement {
    const frag = document.createDocumentFragment()
    const label = document.createElement('div')
    label.className = 'md-code-lang'
    label.textContent = this.lang || 'text'
    const pre = document.createElement('pre')
    pre.className = 'md-code-pre'
    const code = document.createElement('code')
    try {
      const language = this.lang && hljs.getLanguage(this.lang) ? this.lang : ''
      code.innerHTML = language
        ? hljs.highlight(this.code, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(this.code).value
    } catch {
      code.textContent = this.code
    }
    pre.appendChild(code)
    frag.appendChild(label)
    frag.appendChild(pre)
    return frag as unknown as HTMLElement
  }
}

class TableWidget extends EditableBlockWidget {
  constructor(readonly mdSrc: string, from: number, to: number) {
    super(from, to)
    this.baseClass = 'md-block md-table-block'
  }
  protected contentEq(o: this): boolean {
    return o.mdSrc === this.mdSrc
  }
  protected renderContent(): HTMLElement {
    const frag = document.createDocumentFragment()
    const rows = this.mdSrc.split('\n').filter((l) => /^\s*\|/.test(l))
    if (rows.length < 2) {
      const d = document.createElement('div')
      d.textContent = this.mdSrc
      return d
    }
    const parseRow = (row: string) =>
      row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
    // 用 markdown-it 的 renderInline 渲染单元格内联格式（加粗/斜体/代码/链接）
    // 避免把 **加粗** 当纯文本显示星号
    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headTr = document.createElement('tr')
    parseRow(rows[0]).forEach((cell) => {
      const th = document.createElement('th')
      th.innerHTML = md.renderInline(cell)
      headTr.appendChild(th)
    })
    thead.appendChild(headTr)
    table.appendChild(thead)
    const tbody = document.createElement('tbody')
    for (let r = 2; r < rows.length; r++) {
      const tr = document.createElement('tr')
      parseRow(rows[r]).forEach((cell) => {
        const td = document.createElement('td')
        td.innerHTML = md.renderInline(cell)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    frag.appendChild(table)
    return frag as unknown as HTMLElement
  }
}

class MathBlockWidget extends EditableBlockWidget {
  constructor(readonly tex: string, from: number, to: number) {
    super(from, to)
    this.baseClass = 'md-block md-math-block'
  }
  protected contentEq(o: this): boolean {
    return o.tex === this.tex
  }
  protected renderContent(): HTMLElement {
    const d = document.createElement('div')
    d.className = 'md-math-inner'
    try {
      d.innerHTML = katex.renderToString(this.tex, {
        displayMode: true,
        throwOnError: false,
        strict: false,
      })
    } catch {
      d.textContent = this.tex
    }
    return d
  }
}

class MermaidBlockWidget extends EditableBlockWidget {
  private id: string
  constructor(readonly code: string, from: number, to: number) {
    super(from, to)
    this.baseClass = 'md-block md-mermaid-block'
    // 每次渲染用唯一 id，避免光标进出块多次渲染时的 id 冲突
    this.id = `md-mermaid-${Math.random().toString(36).slice(2, 10)}`
  }
  protected contentEq(o: this): boolean {
    // 注意：Mermaid 的 id 是随机生成的，不参与相等性比较。
    // 位置比较由基类 eq 负责。
    return o.code === this.code
  }
  protected renderContent(): HTMLElement {
    const d = document.createElement('div')
    d.className = 'md-mermaid-inner'
    d.textContent = this.code
    return d
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = super.toDOM(view)
    const inner = wrap.querySelector('.md-mermaid-inner') as HTMLElement | null
    if (!inner) return wrap

    mermaid
      .render(this.id, this.code)
      .then(({ svg }) => {
        if (!wrap.isConnected) return
        inner.innerHTML = svg
        view.requestMeasure()
      })
      .catch((err: unknown) => {
        // 打印真实错误，便于排查
        // eslint-disable-next-line no-console
        console.error('[Mermaid 渲染失败]', err)
        if (!wrap.isConnected) return
        inner.innerHTML = `<pre style="color:#cf222e;font-size:12px;white-space:pre-wrap;margin:0">${escapeHtml(this.code)}\n\n${escapeHtml(String(err))}</pre>`
        view.requestMeasure()
      })
    return wrap
  }
}

// --- 提取代码块内部源码（去围栏）---------------------------------------
function stripFence(content: string): string {
  return content.replace(/^[^\n]*\n/, '').replace(/\n[^\n]*$/, '')
}

// --- 构建 block 装饰 ----------------------------------------------------
function buildBlockDecorations(state: EditorState): DecorationSet {
  const blocks = findBlocks(state)
  const decos: Range<Decoration>[] = []

  for (const block of blocks) {
    // 光标在块内 → 不渲染（显源码可编辑）
    if (isCursorInBlock(state, block.from, block.to)) continue

    let widget: WidgetType
    if (block.type === 'mermaid') {
      widget = new MermaidBlockWidget(stripFence(block.content), block.from, block.to)
    } else if (block.type === 'code') {
      widget = new CodeBlockWidget(stripFence(block.content), block.lang || '', block.from, block.to)
    } else if (block.type === 'table') {
      widget = new TableWidget(block.content, block.from, block.to)
    } else {
      widget = new MathBlockWidget(block.content, block.from, block.to)
    }

    decos.push(
      Decoration.replace({ widget, block: true, inclusive: true }).range(block.from, block.to),
    )
  }

  return Decoration.set(decos, true)
}

// --- StateField：提供 block 装饰 ----------------------------------------
export const blockField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state)
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildBlockDecorations(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * atomicRanges：把渲染中的块当作原子单元，键盘导航（方向键/Backspace）
 * 整体跳过，避免光标卡在块边界。只对"当前被渲染（非编辑中）"的块生效。
 */
export const blockAtomicRanges = EditorView.atomicRanges.of((view: EditorView) => {
  const state = view.state
  const blocks = findBlocks(state)
  const decos: Range<Decoration>[] = []
  for (const block of blocks) {
    if (isCursorInBlock(state, block.from, block.to)) continue
    decos.push(Decoration.replace({ block: true }).range(block.from, block.to))
  }
  return Decoration.set(decos, true)
})
