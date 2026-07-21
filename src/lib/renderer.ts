import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'katex'

// markdown-it 的 Token 类型没暴露干净的子路径，用宽松类型避免类型错误阻塞构建
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Token = any

/**
 * 渲染核心：markdown-it 实例 + 代码高亮 + KaTeX 公式 + Mermaid 占位。
 *
 * 设计说明：
 * - Mermaid 不在解析阶段渲染（它是异步且依赖 DOM 的），这里只输出
 *   `<pre class="mermaid" data-raw="...">` 占位，由 MarkdownView 组件在
 *   挂载后统一调用 mermaid.run() 渲染。
 * - KaTeX 用自定义规则，避开 markdown-it-texmath 与代码/表格的兼容性问题。
 *   支持 $inline$ 与 $$block$$，对被反引号包裹的内容不做处理。
 */

// --- KaTeX：把文本中的数学公式渲染成 HTML ------------------------------
// 先处理 $$...$$ 块，再处理 $...$ 行内。用占位符保护代码跨段不互相干扰。
const KATEX_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g
const KATEX_INLINE_RE = /\$([^\$\n]+?)\$/g

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
    })
  } catch (e) {
    return `<span class="katex-error" title="${escapeAttr(String(e))}">${escapeHtml(tex)}</span>`
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/**
 * 在 markdown-it 解析"之前"先抽走 KaTeX，替换为占位 token，
 * 等 markdown-it 生成 HTML 后再把占位还原成 KaTeX 输出。
 * 这样公式内容不会被 markdown 当成普通文本二次处理（比如 _ 下标）。
 *
 * v2.0 修复（关键 bug）：之前对整篇源码跑正则，会破坏代码块/行内代码内的 $...$。
 * 现在先抽走所有代码区域（围栏代码块 + 行内代码），用占位符替换，
 * KaTeX 只处理非代码区域，最后再还原代码。
 *
 * 占位符方案：用 PUA（私用区）字符 U+E000~U+F8FF 的 surrogate pair。
 * 这些字符在 markdown 文档中几乎不会出现，且不会被 markdown-it normalize 改变。
 */
function applyKatex(src: string): { protected: string; slots: string[] } {
  const slots: string[] = []
  const codeSlots: string[] = []

  // 第 1 步：抽走代码区域（防止 KaTeX 正则破坏代码内容）
  // - 围栏代码块：```...``` 或 ~~~...~~~
  // - 行内代码：`...`（含多反引号 ``...``）
  let work = protectCodeRegions(src, codeSlots)

  // 第 2 步：处理 KaTeX（在非代码区域）
  // 占位符用 PUA 字符：U+E000（\uE000）开始，单字符（BMP 内，不需 surrogate pair）
  const PH = (i: number) => `\uE000${i}\uE001`

  work = work.replace(KATEX_BLOCK_RE, (_, tex: string) => {
    const html = renderKatex(tex.trim(), true)
    slots.push(html)
    return PH(slots.length - 1)
  })
  work = work.replace(KATEX_INLINE_RE, (_, tex: string) => {
    const html = renderKatex(tex, false)
    slots.push(html)
    return PH(slots.length - 1)
  })

  // 第 3 步：还原代码区域（KaTeX 处理完毕后）
  work = restoreCodeRegions(work, codeSlots)

  return { protected: work, slots }
}

/** 占位符正则：匹配 \uE000数字\uE001 */
const PH_RE = /\uE000(\d+)\uE001/g

function restoreKatex(html: string, slots: string[]): string {
  return html.replace(PH_RE, (_, i: string) => slots[Number(i)] ?? '')
}

/**
 * 抽走代码区域，用占位符替换。
 * 占位符用 PUA 字符 U+E002 + 索引 + U+E003，与 KaTeX 占位符区分。
 * 返回替换后的文本；codeSlots 按索引存原始代码内容。
 */
function protectCodeRegions(src: string, codeSlots: string[]): string {
  const CODE_PH = (i: number) => `\uE002${i}\uE003`
  let out = src

  // 1. 围栏代码块 ```...``` 或 ~~~...~~~（跨行，非贪婪）
  // 必须先处理围栏（块级），再处理行内
  const fenceRe = /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\2[ \t]*(?=\n|$)/g
  out = out.replace(fenceRe, (full, prefix) => {
    codeSlots.push(full)
    return `${prefix}${CODE_PH(codeSlots.length - 1)}`
  })

  // 2. 行内代码：双反引号 ``...`` 或单反引号 `...`
  // 先处理双反引号（更长的先匹配），再处理单反引号
  const inlineDoubleRe = /``([^`]+)``/g
  out = out.replace(inlineDoubleRe, (full) => {
    codeSlots.push(full)
    return CODE_PH(codeSlots.length - 1)
  })
  const inlineSingleRe = /`([^`\n]+)`/g
  out = out.replace(inlineSingleRe, (full) => {
    codeSlots.push(full)
    return CODE_PH(codeSlots.length - 1)
  })

  return out
}

/** 还原代码区域占位符。 */
function restoreCodeRegions(text: string, codeSlots: string[]): string {
  return text.replace(/\uE002(\d+)\uE003/g, (_, i: string) => codeSlots[Number(i)] ?? '')
}

// --- markdown-it 实例 ---------------------------------------------------
const md = new MarkdownIt({
  html: true, // 允许原始 HTML（信任本地文件）
  linkify: true, // 自动识别裸链接
  typographer: true, // 排版美化（引号等）
  breaks: false, // 不把单换行转成 <br>，遵循 GFM
  highlight(code, lang) {
    // Mermaid 围栏：交给组件层异步渲染
    if (lang === 'mermaid') {
      return `<pre class="mermaid" data-raw="${escapeAttr(code)}"></pre>`
    }
    // 代码高亮
    const language = lang && hljs.getLanguage(lang) ? lang : ''
    let highlighted: string
    try {
      highlighted = language
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value
    } catch {
      highlighted = escapeHtml(code)
    }
    const langLabel = language || 'text'
    return (
      `<pre class="code-block" data-lang="${langLabel}">` +
      `<code class="hljs language-${langLabel}">${highlighted}</code>` +
      `</pre>`
    )
  },
})

// --- 删除线 GFM (~~text~~) ---------------------------------------------
// 简单内联规则，避免引入额外插件依赖。
md.inline.ruler.after('emphasis', 'strikethrough', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x7e /* ~ */ || src.charCodeAt(pos + 1) !== 0x7e) {
    return false
  }
  // 跳过起始 ~~
  const start = pos + 2
  const end = src.indexOf('~~', start)
  if (end === -1) return false
  const content = src.slice(start, end)
  if (!content || content.includes('\n\n')) return false

  if (!silent) {
    const token = state.push('s_open', 'del', 1)
    token.markup = '~~'
    const text = state.push('text', '', 0)
    text.content = content
    const close = state.push('s_close', 'del', -1)
    close.markup = '~~'
  }
  state.pos = end + 2
  return true
})

// 任务列表：把 [ ] / [x] 开头的列表项标记成任务 -------------------------
// v2.0 修复：之前遍历所有 inline token，会把普通段落（如 "[ ] 待办" 独立成段）
// 也变成任务项。现在用状态机跟踪 list_item 上下文，只处理 list_item 内的 inline。
md.core.ruler.after('normalize', 'task_lists', (state) => {
  // 用栈跟踪 list_item 嵌套（支持任务列表嵌套在普通列表里）
  const listItemStack: Array<{ bullet: boolean; firstInlineDone: boolean }> = []
  for (let idx = 0; idx < state.tokens.length; idx++) {
    const tok = state.tokens[idx]
    if (tok.type === 'bullet_list_open') {
      listItemStack.push({ bullet: true, firstInlineDone: false })
      continue
    }
    if (tok.type === 'ordered_list_open') {
      listItemStack.push({ bullet: false, firstInlineDone: false })
      continue
    }
    if (tok.type === 'bullet_list_close' || tok.type === 'ordered_list_close') {
      listItemStack.pop()
      continue
    }
    if (tok.type === 'list_item_open') {
      // 标记当前 list_item 的第一个 inline 还没处理
      // 用 tok 的隐藏字段记录（不污染序列化，markdown-it 内部用）
      ;(tok as unknown as { _firstInlineDone?: boolean })._firstInlineDone = false
      continue
    }
    if (tok.type !== 'inline' || !tok.children) continue

    // 检查是否在 list_item 内（通过找前面最近的未关闭 list_item_open）
    const inListItem = isInListItem(state.tokens, idx)
    if (!inListItem) continue

    // 只处理每个 list_item 的第一个 inline
    const listItemTok = findEnclosingListItem(state.tokens, idx)
    if (!listItemTok) continue
    const flag = listItemTok as unknown as { _firstInlineDone?: boolean }
    if (flag._firstInlineDone) continue
    flag._firstInlineDone = true

    // 找第一个 text child，匹配 [ ] / [x]
    for (let i = 0; i < tok.children.length; i++) {
      const c0 = tok.children[i]
      if (c0.type !== 'text') continue
      const m = c0.content.match(/^\[([ xX])\]\s+/)
      if (!m) break // 第一个 text 不匹配就放弃（GFM 要求 task marker 在最前面）
      const checked = m[1].toLowerCase() === 'x'
      c0.content = c0.content.slice(m[0].length)
      const checkbox = new state.Token('html_inline', '', 0)
      checkbox.content =
        `<input type="checkbox" class="task-checkbox" ${checked ? 'checked disabled' : 'disabled'} /> `
      tok.children.splice(i, 0, checkbox)
      break
    }
  }
})

/** 判断位置 idx 的 token 是否在 list_item 内。 */
function isInListItem(tokens: Token[], idx: number): boolean {
  return findEnclosingListItem(tokens, idx) !== null
}

/** 找位置 idx 之前最近的未闭合 list_item_open token。 */
function findEnclosingListItem(tokens: Token[], idx: number): Token | null {
  let depth = 0
  for (let i = idx - 1; i >= 0; i--) {
    const t = tokens[i]
    if (t.type === 'list_item_close') depth++
    else if (t.type === 'list_item_open') {
      if (depth === 0) return t
      depth--
    }
  }
  return null
}

// --- 源行映射：给块级元素注入 data-source-line --------------------------
// markdown-it 的 block token 自带 map: [startLine, endLine]（0 基）。
// 利用 renderer override 把起始行写到对应 HTML 标签上，供滚动同步使用。
// 这是 VSCode/Obsidian 等采用的"块级精确"同步方案，远优于按比例同步。
function setupSourceLine() {
  // 覆盖所有 *_open 渲染器：把 data-source-line 加到 attrs
  const openRenderers = [
    'paragraph_open',
    'heading_open',
    'bullet_list_open',
    'ordered_list_open',
    'list_item_open',
    'blockquote_open',
    'table_open',
    'fence',
    'hr',
    'html_block',
  ]
  for (const name of openRenderers) {
    const original = md.renderer.rules[name]
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const tok = tokens[idx]
      const map = tok?.map
      if (map) {
        // 起始行（转 1 基，更直观）
        const line = map[0] + 1
        tok.attrSet('data-source-line', String(line))
      }
      if (original) {
        return original(tokens, idx, options, env, self)
      }
      return self.renderToken(tokens, idx, options)
    }
  }
}
setupSourceLine()

/**
 * 主渲染入口：Markdown 字符串 -> HTML 字符串。
 * 返回值尚未渲染 Mermaid（含 <pre class="mermaid"> 占位），组件层处理。
 */
export function renderMarkdown(src: string): string {
  const { protected: protectedSrc, slots } = applyKatex(src)
  let html = md.render(protectedSrc)
  html = restoreKatex(html, slots)
  return html
}

export { md }
